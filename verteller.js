// ============================================================
//  Zeilrace — de verteller: notities in het scheepsjournaal
//  · elk uur na het startsein
//  · bij de eerste gebeurtenissen (eerste over de startlijn, eerste rond
//    elke boei, eerste finish) — maximaal één zo'n notitie per half uur
//  · als de laatste boot binnen is
//  Geen AI: de zinnen worden opgebouwd uit de sporen, tijden en
//  rondingen. Iedereen die het dashboard opent ziet dezelfde notities,
//  ook van de uren vóórdat hij keek (ze worden uit de sporen herleid).
//
//  Verteller.journaal(d) → [{ t, kop, tekst }]   (oud → nieuw)
//    d = { raceStart, startPlan, times, rounded, boeien, lijnen,
//          sporen: {boot: [{lat,lng,ts}]}, naam: boot => string,
//          nu, wind: { kn, richting } | null }
// ============================================================
const Verteller = (() => {
  const UUR = 3600e3;

  // Vaste 'willekeur' per notitie, zodat iedereen dezelfde zinnen ziet
  function kiezer(zaad) {
    let s = zaad % 2147483647; if (s <= 0) s += 2147483646;
    return lijst => { s = s * 16807 % 2147483647; return lijst[s % lijst.length]; };
  }
  const plat = s => s.replace(/\s+/g, ' ').trim();
  const opsomming = a => a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' en ' + a[a.length - 1];
  const doelNaam = l => l === 'Startlijn' ? 'de startlijn' : l === 'Finish' ? 'de finish' : l.toLowerCase();

  // Laatste spoorpunt op of vóór tijdstip t
  function puntOp(pts, t) {
    if (!pts || !pts.length || pts[0].ts > t) return null;
    let lo = 0, hi = pts.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pts[m].ts <= t) lo = m; else hi = m - 1; }
    return pts[lo];
  }
  // Gemiddelde snelheid (kn) over de 10 minuten vóór t
  function snelheidOp(pts, t) {
    const eind = puntOp(pts, t), begin = puntOp(pts, t - 10 * 60e3);
    if (!eind || !begin || eind.ts - begin.ts < 60e3) return null;
    return afstandMeter(begin, eind) / ((eind.ts - begin.ts) / 1000) * 1.94384;
  }

  // Toestand van alle boten op tijdstip t
  function toestand(d, t) {
    return FLEET.map(b => {
      const tm = d.times[b] || {}, rd = d.rounded[b] || {};
      const start = tm.start != null && tm.start <= t ? tm.start : null;
      const finish = tm.finish != null && tm.finish <= t ? tm.finish : null;
      const gerond = {};
      d.boeien.forEach((bo, i) => { const id = boeiId(bo, i); if (rd[id] != null && rd[id] <= t) gerond[id] = rd[id]; });
      const aantalGerond = Object.keys(gerond).length;
      const p = puntOp(d.sporen[b], t);
      let doel = null, afst = null;
      if (p && finish == null) {
        doel = doelVanBoot(p, start, finish, gerond, d.lijnen, d.boeien);
        if (doel) afst = afstandMeter(p, doel.punt);
      }
      // voortgang: start + gerond + finish; binnen een rak telt de afstand tot het doel,
      // en zonder positie: wie het laatste merkteken het eerst haalde
      const benen = (start != null ? 1 : 0) + aantalGerond + (finish != null ? 1 : 0);
      const mijlpaal = Math.max(start || 0, finish || 0, ...Object.values(gerond));
      return { boot: b, naam: d.naam(b), start, finish, aantalGerond, pos: p, doel, afst, benen, mijlpaal,
               kn: snelheidOp(d.sporen[b], t) };
    }).sort((a, c) =>
      (a.finish != null && c.finish != null) ? a.finish - c.finish :
      c.benen - a.benen ||
      (a.afst != null && c.afst != null ? a.afst - c.afst : a.mijlpaal - c.mijlpaal));
  }

  // voor = optionele openingszin (bij een gebeurtenis); de zinkeuze hangt af van
  // het tijdstip, zodat iedereen (en elk moment) dezelfde tekst ziet
  function notitie(d, t, laatste, voor) {
    const kies = kiezer(Math.floor(d.raceStart / 1000) + Math.floor(t / 1000) * 7919);
    const vloot = toestand(d, t), zinnen = voor ? [voor(kies)] : [];
    const onderweg = vloot.filter(v => v.start != null && v.finish == null);
    const binnen = vloot.filter(v => v.finish != null);
    const wachtend = vloot.filter(v => v.start == null);
    const [eerste, tweede] = vloot;

    // 0. Startschot gegeven, maar nog niemand over de lijn
    if (!onderweg.length && !binnen.length) {
      zinnen.push(kies([
        'Het startschot heeft geklonken, maar nog geen schip heeft de startlijn gekruist.',
        'Het kanon heeft gesproken — nu is het wachten op het eerste schip over de startlijn.']));
      const bijLijn = wachtend.filter(v => v.doel && v.afst != null)
        .map(v => `${v.naam} ligt op ${formatAfstand(v.afst)}`);
      if (bijLijn.length) zinnen.push(`${opsomming(bijLijn)} van de lijn.`);
    }

    // 1. De kop van de vloot
    if (eerste.finish != null && binnen.length === FLEET.length) {
      zinnen.push(`${eerste.naam} was als eerste binnen, om ${klokHM(eerste.finish)}.`);
    } else if (eerste.finish != null) {
      zinnen.push(kies([
        `${eerste.naam} ligt al binnen en kijkt met een glas rum toe hoe de rest ploetert.`,
        `${eerste.naam} heeft de finish al gehaald en mag het anker laten vallen.`]));
    } else if (eerste.start != null && eerste.doel) {
      const nog = eerste.afst != null ? ` Nog ${formatAfstand(eerste.afst)} te gaan.` : '';
      zinnen.push(kies([
        `${eerste.naam} voert de vloot aan en zet koers naar ${doelNaam(eerste.doel.label)}.`,
        `Aan kop vaart ${eerste.naam}, op weg naar ${doelNaam(eerste.doel.label)}.`,
        `${eerste.naam} leidt de jacht; ${doelNaam(eerste.doel.label)} ligt in het vizier.`]) + nog);
    } else if (eerste.start != null) {
      zinnen.push(`${eerste.naam} ligt voorop.`);
    }

    // 2. De achtervolger(s)
    if (tweede && tweede.start != null && tweede.finish == null && eerste.start != null) {
      if (eerste.finish == null && tweede.benen === eerste.benen && tweede.afst != null && eerste.afst != null) {
        const gat = tweede.afst - eerste.afst;
        zinnen.push(gat < 150
          ? kies([`${tweede.naam} zit er vlak achter — dit is nog lang niet beslist!`,
                  `${tweede.naam} ligt op een kanonschot afstand, nog geen ${formatAfstand(Math.max(gat, 20))} erachter.`])
          : kies([`${tweede.naam} volgt op ${formatAfstand(gat)}.`,
                  `${tweede.naam} jaagt erachteraan, ${formatAfstand(gat)} achterstand.`]));
      } else if (eerste.finish == null && tweede.benen < eerste.benen) {
        const k = eerste.benen - tweede.benen;
        zinnen.push(`${tweede.naam} moet nog ${k === 1 ? 'één merkteken' : k + ' merktekens'} meer halen dan de koploper.`);
      } else if (tweede.doel && tweede.afst != null) {
        zinnen.push(`${tweede.naam} is onderweg naar ${doelNaam(tweede.doel.label)}, nog ${formatAfstand(tweede.afst)}.`);
      }
    }
    const rest = onderweg.filter(v => v !== eerste && v !== tweede);
    rest.forEach(v => { if (v.doel && v.afst != null)
      zinnen.push(`${v.naam} sluit de rij, nog ${formatAfstand(v.afst)} tot ${doelNaam(v.doel.label)}.`); });

    // 3. Wat er het afgelopen uur gebeurde
    const sinds = t - UUR, gebeurd = [];
    vloot.forEach(v => {
      const rd = d.rounded[v.boot] || {};
      const nrs = d.boeien.map((bo, i) => [i + 1, rd[boeiId(bo, i)]]).filter(([, ts]) => ts != null && ts > sinds && ts <= t).map(([n]) => n);
      if (nrs.length) gebeurd.push(`${v.naam} rondde boei ${opsomming(nrs.map(String))}`);
      if (v.finish != null && v.finish > sinds) gebeurd.push(`${v.naam} kwam om ${klokHM(v.finish)} over de finish`);
    });
    if (gebeurd.length) zinnen.push(`Het afgelopen uur: ${opsomming(gebeurd)}.`);

    // 4. De snelste
    const snel = onderweg.filter(v => v.kn != null && v.kn > 0.5).sort((a, c) => c.kn - a.kn)[0];
    if (snel && onderweg.length > 1) zinnen.push(kies([
      `${snel.naam} heeft nu de meeste vaart: ${snel.kn.toFixed(1)} knopen.`,
      `Snelste schip op dit moment: ${snel.naam}, ${snel.kn.toFixed(1)} kn.`]));

    // 5. Boten die nog niet gestart zijn: wachten op hun eigen sein (achtervolging) of nog niet over de lijn
    if (wachtend.length && onderweg.length) {
      const eigenSein = v => d.raceStart + vertragingVan(d.startPlan, v.boot);
      const opSein = wachtend.filter(v => eigenSein(v) > t), laat = wachtend.filter(v => eigenSein(v) <= t);
      const meer = a => a.length > 1;
      if (opSein.length) zinnen.push(`${opsomming(opSein.map(v => v.naam))} ${meer(opSein) ? 'wachten' : 'wacht'} nog op ${meer(opSein) ? 'hun' : 'het eigen'} startsein.`);
      if (laat.length) zinnen.push(`${opsomming(laat.map(v => v.naam))} ${meer(laat) ? 'moeten' : 'moet'} de startlijn nog over.`);
    }

    // 6. Wind (alleen bij de nieuwste notitie: we kennen alleen de actuele wind)
    if (laatste && d.wind && d.wind.kn != null)
      zinnen.push(`De wind: ${bft(d.wind.kn)} Bft${d.wind.richting != null ? ' uit het ' + kompas(d.wind.richting) : ''}.`);

    if (binnen.length === FLEET.length)
      zinnen.push(kies(['Alle schepen zijn binnen. Tijd voor de buit!', 'De hele vloot ligt binnen — op naar de uitslag!']));

    return plat(zinnen.join(' ')) || 'Stilte op zee. Nog geen boot heeft de startlijn gekruist.';
  }

  // Eerste gebeurtenissen: eerste over de startlijn, eerste rond elke boei, eerste finish
  const HALF_UUR = UUR / 2;
  function eersteGebeurtenissen(d, einde) {
    const eerste = waarde => {                         // {boot, t} met de vroegste tijd
      let best = null;
      FLEET.forEach(b => { const t = waarde(b); if (t != null && t <= einde && (!best || t < best.t)) best = { boot: b, t }; });
      return best;
    };
    const ev = [];
    const s = eerste(b => d.times[b] && d.times[b].start);
    if (s) ev.push(Object.assign(s, { kop: 'eerste over de startlijn', voor: k => k([
      `${d.naam(s.boot)} kruist als eerste de startlijn — de jacht is geopend!`,
      `Als eerste over de startlijn: ${d.naam(s.boot)}!`]) }));
    d.boeien.forEach((bo, i) => {
      const id = boeiId(bo, i), r = eerste(b => d.rounded[b] && d.rounded[b][id]);
      if (r) ev.push(Object.assign(r, { kop: `boei ${i + 1} als eerste gerond`, voor: k => k([
        `${d.naam(r.boot)} rondt als eerste boei ${i + 1}.`,
        `Boei ${i + 1} is bereikt: ${d.naam(r.boot)} gaat er als eerste omheen.`]) }));
    });
    const f = eerste(b => d.times[b] && d.times[b].finish);
    if (f && FLEET.length > 1) ev.push(Object.assign(f, { kop: 'eerste finish', voor: k => k([
      `${d.naam(f.boot)} komt als eerste over de finish! 🏁`,
      `De eerste finish is binnen: ${d.naam(f.boot)} haalt als eerste de haven! 🏁`]) }));
    // maximaal één gebeurtenisnotitie per half uur
    ev.sort((a, b) => a.t - b.t);
    let vorige = -Infinity;
    return ev.filter(e => { if (e.t - vorige < HALF_UUR) return false; vorige = e.t; return true; });
  }

  function journaal(d) {
    if (!d.raceStart || d.nu < d.raceStart) return [];
    const finishes = FLEET.map(b => ({ b, t: d.times[b] && d.times[b].finish })).filter(x => x.t != null);
    const laatsteBinnen = finishes.length === FLEET.length ? finishes.sort((a, c) => c.t - a.t)[0] : null;
    const allesBinnen = laatsteBinnen ? laatsteBinnen.t : null;
    const einde = allesBinnen != null ? Math.min(d.nu, allesBinnen) : d.nu;
    const uit = [];
    for (let k = 1; d.raceStart + k * UUR <= einde; k++) {
      const t = d.raceStart + k * UUR;
      uit.push({ t, kop: `${klokHM(t)} · ${k} uur onderweg` });
    }
    eersteGebeurtenissen(d, einde).forEach(e => uit.push({ t: e.t, kop: `${klokHM(e.t)} · ${e.kop}`, voor: e.voor }));
    if (allesBinnen != null && allesBinnen <= d.nu)
      uit.push({ t: allesBinnen, kop: `${klokHM(allesBinnen)} · de laatste boot is binnen`,
        voor: k => k([`${d.naam(laatsteBinnen.b)} komt als laatste over de finish.`,
                      `Als laatste meert ${d.naam(laatsteBinnen.b)} af: de finish is gehaald.`]) });
    uit.sort((a, b) => a.t - b.t);
    uit.forEach((n, i) => { n.tekst = notitie(d, n.t, i === uit.length - 1, n.voor); delete n.voor; });
    return uit;
  }
  // Een notitie over dít moment (testknop van de wedstrijdleiding)
  function notitieNu(d) {
    if (!d.raceStart) return { t: d.nu, kop: `${klokHM(d.nu)} · test`, tekst: 'Er is nog geen startsein gegeven: de vloot ligt nog in de haven.' };
    if (d.nu < d.raceStart) return { t: d.nu, kop: `${klokHM(d.nu)} · test`,
      tekst: `De vloot wacht op het startschot van ${klokHM(d.raceStart)}. De kanonnen worden geladen…` };
    const uur = (d.nu - d.raceStart) / UUR;
    const duur = uur < 1 ? `${Math.round(uur * 60)} min onderweg` : `${uur.toFixed(1).replace('.', ',')} uur onderweg`;
    return { t: d.nu, kop: `${klokHM(d.nu)} · ${duur} · test`, tekst: notitie(d, d.nu, true) };
  }
  // Wanneer komt de volgende notitie?
  function volgende(d) {
    if (!d.raceStart || d.nu < d.raceStart) return null;
    return d.raceStart + (Math.floor((d.nu - d.raceStart) / UUR) + 1) * UUR;
  }
  return { journaal, volgende, notitieNu };
})();
