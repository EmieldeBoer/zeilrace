// ============================================================
//  Zeilrace — de verteller: notities in het scheepsjournaal
//  · elk uur na het startsein
//  · bij gebeurtenissen: eerste over de startlijn, eerste rond elke boei,
//    eerste finish, en een wisseling aan kop — maximaal één zo'n notitie
//    per half uur
//  · een slotnotitie met de uitslag (op het water én met de rating) als de
//    laatste boot binnen is, of als de race wordt afgerond
//  Geen AI: de zinnen worden opgebouwd uit de sporen, tijden en
//  rondingen. Iedereen die het dashboard opent ziet dezelfde notities,
//  ook van de uren vóórdat hij keek (ze worden uit de sporen herleid).
//
//  Verteller.journaal(d) → [{ t, kop, tekst }]   (oud → nieuw)
//    d = { raceStart, startPlan, times, rounded, boeien, lijnen,
//          sporen: {boot: [{lat,lng,ts}]}, naam: boot => string,
//          nu, wind: { kn, richting } | null, afgerond?: true }
// ============================================================
const Verteller = (() => {
  const UUR = 3600e3, HALF_UUR = UUR / 2, MINUUT = 60e3;

  // Vaste 'willekeur' per notitie, zodat iedereen dezelfde zinnen ziet
  function kiezer(zaad) {
    let s = zaad % 2147483647; if (s <= 0) s += 2147483646;
    return lijst => { s = s * 16807 % 2147483647; return lijst[s % lijst.length]; };
  }
  const plat = s => s.replace(/\s+/g, ' ').trim();
  const opsomming = a => a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' en ' + a[a.length - 1];
  const doelNaam = l => l === 'Startlijn' ? 'de startlijn' : l === 'Finish' ? 'de finish' : l.toLowerCase();
  const isAchter = d => !!(d.startPlan && d.startPlan.modus === 'achtervolging');

  // Laatste spoorpunt op of vóór tijdstip t
  function puntOp(pts, t) {
    if (!pts || !pts.length || pts[0].ts > t) return null;
    let lo = 0, hi = pts.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pts[m].ts <= t) lo = m; else hi = m - 1; }
    return pts[lo];
  }
  // Gemiddelde snelheid (kn) over de 10 minuten vóór t
  function snelheidOp(pts, t) {
    const eind = puntOp(pts, t), begin = puntOp(pts, t - 10 * MINUUT);
    if (!eind || !begin || eind.ts - begin.ts < MINUUT) return null;
    return afstandMeter(begin, eind) / ((eind.ts - begin.ts) / 1000) * 1.94384;
  }

  // Startsein van een boot: het startschot, bij een achtervolgingsstart plus de eigen vertraging
  const startSein = (d, b) => d.raceStart + vertragingVan(d.startPlan, b);
  // Starttijd voor het verhaal: een lijnkruising vóór het eigen startsein (bijv. van een
  // eerder gegeven sein) telt als start op het moment van het sein zelf
  const startVan = (d, b) => { const s = d.times[b] && d.times[b].start; return s == null ? null : Math.max(s, startSein(d, b)); };
  const finishVan = (d, b) => { const f = d.times[b] && d.times[b].finish; return f == null ? null : f; };

  // Wie doet er mee? Boten met een start, of met een spoor rond de race.
  // (Een boot die niet uitvaart, hoort niet in het verhaal.)
  function deelnemers(d) {
    const v = FLEET.filter(b => startVan(d, b) != null ||
      (d.sporen[b] || []).some(p => p.ts >= d.raceStart - 15 * MINUUT && p.ts <= d.nu));
    return v.length ? v : [];
  }

  // Toestand van de deelnemers op tijdstip t, gesorteerd op positie in de race
  function toestand(d, t) {
    return d.deelnemers.map(b => {
      const rd = d.rounded[b] || {};
      const s0 = startVan(d, b), start = s0 != null && s0 <= t ? s0 : null;
      const f0 = finishVan(d, b), finish = f0 != null && f0 <= t ? f0 : null;
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

  // Tijden zoals ze op tijdstip t bekend waren (voor gecorrigeerde tijden en 'om te winnen')
  function tijdenOp(d, t) {
    const uit = {};
    d.deelnemers.forEach(b => {
      const s = startVan(d, b), f = finishVan(d, b);
      uit[b] = { start: s != null && s <= t ? s : null, finish: f != null && f <= t ? f : null };
    });
    return uit;
  }
  const verzeild = (d, b, f) => f - eigenStartVan(b, {}, d.raceStart, d.startPlan);
  // De rating die in déze race gold (bij oude races uit de bewaarde uitslag), anders de huidige
  const ratingVan = (d, b) => (d.ratings && d.ratings[b]) || BOTEN[b].rating;
  const gecorr = (d, b, f) => isAchter(d) ? f - d.raceStart : verzeild(d, b, f) * ratingVan(d, b);

  // ---- Eén notitie op tijdstip t ----
  // o = { soort: 'uur'|'start'|'boei'|'finish'|'kop'|'einde'|'test', voor, onderwerp, vorigeT, laatste }
  function notitie(d, t, o) {
    const kies = kiezer(Math.floor(d.raceStart / 1000) + Math.floor(t / 1000) * 7919);
    const vloot = toestand(d, t), zinnen = o.voor ? [o.voor(kies)] : [];
    if (!vloot.length) return plat(zinnen.join(' ')) || 'Stilte op zee: er is nog geen schip uitgevaren.';
    const onderweg = vloot.filter(v => v.start != null && v.finish == null);
    const binnen = vloot.filter(v => v.finish != null);
    const wachtend = vloot.filter(v => v.start == null);
    const [eerste, tweede] = vloot;
    const einde = o.soort === 'einde';

    // 0. Startschot gegeven, maar nog niemand over de lijn
    if (!onderweg.length && !binnen.length) {
      zinnen.push(kies([
        'Het startschot heeft geklonken, maar nog geen schip heeft de startlijn gekruist.',
        'Het kanon heeft gesproken — nu is het wachten op het eerste schip over de startlijn.']));
      const bijLijn = wachtend.filter(v => v.doel && v.afst != null).map(v => `${v.naam} ligt op ${formatAfstand(v.afst)}`);
      if (bijLijn.length) zinnen.push(`${opsomming(bijLijn)} van de lijn.`);
    }

    if (einde) return slot(d, t, kies, zinnen, vloot);

    // Ingehaald? Andere koploper dan bij de vorige notitie (en dat was geen wisseling-notitie)
    if (o.vorigeT != null && o.soort !== 'kop') {
      const vorigeKop = toestand(d, o.vorigeT).filter(v => v.start != null)[0];
      if (vorigeKop && eerste.start != null && vorigeKop.boot !== eerste.boot && vorigeKop.finish == null)
        zinnen.push(kies([`${eerste.naam} heeft ${vorigeKop.naam} onderweg ingehaald.`,
                          `Sinds ${klokHM(o.vorigeT)} is ${eerste.naam} ${vorigeKop.naam} voorbij gegaan.`]));
    }

    // 1. De kop van de vloot (niet herhalen als de openingszin al over deze boot ging)
    const alGenoemd = o.onderwerp === eerste.boot && (o.soort === 'finish' || o.soort === 'kop');
    if (!alGenoemd) {
      if (eerste.finish != null) {
        zinnen.push(kies([
          `${eerste.naam} ligt al binnen en kijkt met een glas rum toe hoe de rest ploetert.`,
          `${eerste.naam} heeft de finish al gehaald en mag het anker laten vallen.`,
          `${eerste.naam} ligt al veilig in de haven.`]));
      } else if (eerste.start != null && eerste.doel) {
        const nog = eerste.afst != null ? ` Nog ${formatAfstand(eerste.afst)} te gaan.` : '';
        zinnen.push(kies([
          `${eerste.naam} voert de vloot aan en zet koers naar ${doelNaam(eerste.doel.label)}.`,
          `Aan kop vaart ${eerste.naam}, op weg naar ${doelNaam(eerste.doel.label)}.`,
          `${eerste.naam} leidt de jacht; ${doelNaam(eerste.doel.label)} ligt in het vizier.`]) + nog);
      } else if (eerste.start != null) {
        zinnen.push(`${eerste.naam} ligt voorop.`);
      }
    } else if (o.soort === 'kop' && eerste.doel && eerste.afst != null) {
      zinnen.push(`Nog ${formatAfstand(eerste.afst)} tot ${doelNaam(eerste.doel.label)}.`);
    }

    // 2. De achtervolger(s)
    if (tweede && tweede.start != null && tweede.finish == null && eerste.start != null) {
      if (eerste.finish == null && tweede.benen === eerste.benen && tweede.afst != null && eerste.afst != null) {
        const gat = tweede.afst - eerste.afst;
        zinnen.push(gat < 150
          ? kies([`${tweede.naam} zit er vlak achter — dit is nog lang niet beslist!`,
                  `${tweede.naam} ligt op een kanonschot afstand.`])
          : kies([`${tweede.naam} volgt op ${formatAfstand(gat)}.`,
                  `${tweede.naam} jaagt erachteraan, ${formatAfstand(gat)} achterstand.`]));
      } else if (eerste.finish == null && tweede.benen < eerste.benen) {
        const k = eerste.benen - tweede.benen;
        zinnen.push(`${tweede.naam} moet nog ${k === 1 ? 'één merkteken' : k + ' merktekens'} meer halen dan de koploper.`);
      } else if (tweede.doel && tweede.afst != null) {
        zinnen.push(`${tweede.naam} is onderweg naar ${doelNaam(tweede.doel.label)}, nog ${formatAfstand(tweede.afst)}.`);
      }
    }
    onderweg.filter(v => v !== eerste && v !== tweede).forEach(v => { if (v.doel && v.afst != null)
      zinnen.push(`${v.naam} sluit de rij, nog ${formatAfstand(v.afst)} tot ${doelNaam(v.doel.label)}.`); });

    // 3. Wat er sinds de vorige notitie gebeurde (niet wat de openingszin al vertelde)
    const sinds = o.vorigeT != null ? o.vorigeT : d.raceStart, gebeurd = [];
    vloot.forEach(v => {
      const rd = d.rounded[v.boot] || {};
      const nrs = d.boeien.map((bo, i) => [i + 1, rd[boeiId(bo, i)]])
        .filter(([, ts]) => ts != null && ts > sinds && ts <= t && !(o.soort === 'boei' && ts === t)).map(([n]) => n);
      if (nrs.length) gebeurd.push(`${v.naam} rondde boei ${opsomming(nrs.map(String))}`);
      if (v.finish != null && v.finish > sinds && !(o.soort === 'finish' && v.boot === o.onderwerp))
        gebeurd.push(`${v.naam} kwam om ${klokHM(v.finish)} over de finish`);
    });
    if (gebeurd.length) zinnen.push(`${sinds <= d.raceStart ? 'Sinds het startschot' : 'Sinds ' + klokHM(sinds)}: ${opsomming(gebeurd)}.`);

    // 4. De stand met de rating: wie staat er op gecorrigeerde tijd voor, en wie kan nog winnen?
    if (binnen.length) {
      if (isAchter(d)) {
        if (!(o.soort === 'finish' && o.onderwerp === binnen[0].boot))      // de openingszin zei het al
          zinnen.push(`In de achtervolging telt de finishvolgorde: ${binnen[0].naam} heeft de race gewonnen.`);
      } else {
        const beste = [...binnen].sort((a, c) => gecorr(d, a.boot, a.finish) - gecorr(d, c.boot, c.finish))[0];
        zinnen.push(binnen.length === 1
          ? `Op gecorrigeerde tijd zet ${beste.naam} de maatstaf: ${formatDuur(gecorr(d, beste.boot, beste.finish))}.`
          : `Op gecorrigeerde tijd staat ${beste.naam} voorlopig bovenaan (${formatDuur(gecorr(d, beste.boot, beste.finish))}).`);
        const tijden = tijdenOp(d, t);
        onderweg.forEach(v => {
          const w = tijdOmTeWinnen(v.boot, tijden, d.raceStart, d.startPlan, t);
          if (!w) return;
          // Is dat nog te halen? Benodigde snelheid over de resterende afstand (rechte lijn)
          const nodigKn = v.afst != null && w.rest ? (v.afst / 1852) / (w.rest / UUR) : null;
          const haalbaar = nodigKn == null ? '' : nodigKn > 12 || (v.kn != null && nodigKn > v.kn * 2)
            ? ` — met nog ${formatAfstand(v.afst)} te gaan is dat niet meer te halen`
            : ` — dat vraagt gemiddeld ${nodigKn.toFixed(1)} kn${v.kn != null ? ` (nu ${v.kn.toFixed(1)} kn)` : ''}`;
          if (w.rest == null) zinnen.push(`${v.naam} kan ${beste.naam} met de rating niet meer inhalen.`);
          else if (w.plek === 1) zinnen.push(`${v.naam} moet vóór ${klokHM(w.tot)} binnen zijn om nog te winnen${haalbaar}.`);
          else zinnen.push(`Voor ${v.naam} zit winnen er niet meer in, maar plek ${w.plek} nog wel: binnen vóór ${klokHM(w.tot)}${haalbaar}.`);
        });
      }
    }

    // 5. De snelste (alleen in de vaste notities, niet bij elke gebeurtenis)
    if (o.soort === 'uur' || o.soort === 'test' || o.uur) {
      const snel = onderweg.filter(v => v.kn != null && v.kn > 0.5).sort((a, c) => c.kn - a.kn)[0];
      if (snel && onderweg.length > 1) zinnen.push(kies([
        `${snel.naam} heeft nu de meeste vaart: ${snel.kn.toFixed(1)} knopen.`,
        `Snelste schip op dit moment: ${snel.naam}, ${snel.kn.toFixed(1)} kn.`]));
    }

    // 6. Boten die nog niet over de startlijn zijn. Bij een gelijke start klinkt één
    //    startschot voor iedereen: de klok loopt dan al. Alleen bij een achtervolgingsstart
    //    hebben boten een eigen, later startsein.
    if (wachtend.length && onderweg.length) {
      const opSein = wachtend.filter(v => startSein(d, v.boot) > t), laat = wachtend.filter(v => startSein(d, v.boot) <= t);
      opSein.forEach(v => zinnen.push(`${v.naam} start later (achtervolging) en wacht nog op het eigen startsein van ${klokHM(startSein(d, v.boot))}.`));
      if (laat.length) zinnen.push(`${opsomming(laat.map(v => v.naam))} ${laat.length > 1 ? 'zijn' : 'is'} nog niet over de startlijn — ` +
        `de klok loopt al sinds het startschot van ${klokHM(d.raceStart)}.`);
    }

    // 7. Wind (alleen bij de nieuwste notitie: we kennen alleen de actuele wind)
    if (o.laatste && d.wind && d.wind.kn != null)
      zinnen.push(`De wind: ${bft(d.wind.kn)} Bft${d.wind.richting != null ? ' uit het ' + kompas(d.wind.richting) : ''}.`);

    return plat(zinnen.join(' ')) || 'Stilte op zee.';
  }

  // ---- De slotnotitie: uitslag op het water en met de rating ----
  function slot(d, t, kies, zinnen, vloot) {
    const binnen = vloot.filter(v => v.finish != null), niet = vloot.filter(v => v.finish == null);
    if (binnen.length) {
      const water = [...binnen].sort((a, c) => a.finish - c.finish);
      zinnen.push('Op het water: ' + water.map((v, i) => `${i + 1}. ${v.naam} (${formatDuur(verzeild(d, v.boot, v.finish))})`).join(', ') + '.');
      if (isAchter(d)) {
        zinnen.push(`In de achtervolging telt de finishvolgorde: ${water[0].naam} wint! De ratings zaten al in de ` +
          `startvertragingen (${d.deelnemers.map(b => `${d.naam(b)} ${ratingVan(d, b).toFixed(3)}`).join(', ')}).`);
      } else if (binnen.length > 1) {
        const rating = [...binnen].sort((a, c) => gecorr(d, a.boot, a.finish) - gecorr(d, c.boot, c.finish));
        zinnen.push('De uitslag met de rating (verzeilde tijd × rating): ' + rating.map((v, i) =>
          `${i + 1}. ${v.naam} — ${formatDuur(verzeild(d, v.boot, v.finish))} × ${ratingVan(d, v.boot).toFixed(3)} = ` +
          `${formatDuur(gecorr(d, v.boot, v.finish))}`).join('; ') + '.');
        const [w, t2] = rating;
        zinnen.push(`${w.naam} wint met ${formatDuur(gecorr(d, t2.boot, t2.finish) - gecorr(d, w.boot, w.finish))} voorsprong op ${t2.naam}.`);
        const stijgers = rating.filter((v, i) => water.indexOf(v) > i);
        if (stijgers.length) zinnen.push(`De rating husselt de volgorde: ${opsomming(stijgers.map(v =>
          `${v.naam} klimt van plek ${water.indexOf(v) + 1} naar ${rating.indexOf(v) + 1}`))}.`);
        else zinnen.push(kies([`${w.naam} wint op het water én met de rating.`,
                               `Geen verrassingen: ${w.naam} wint zowel op het water als met de rating.`]));
      }
    }
    if (niet.length) zinnen.push(`${opsomming(niet.map(v => v.naam))} ${niet.length > 1 ? 'kwamen' : 'kwam'} niet binnen.`);
    zinnen.push(niet.length ? 'De race is afgerond.'
      : kies(['Alle schepen zijn binnen. Tijd voor de buit!', 'De hele vloot ligt binnen — op naar de uitslag!']));
    return plat(zinnen.join(' '));
  }

  // ---- Gebeurtenissen: eerste over de startlijn, eerste rond elke boei, eerste finish ----
  function eersteGebeurtenissen(d, einde) {
    const eerste = waarde => {                         // {boot, t} met de vroegste tijd
      let best = null;
      d.deelnemers.forEach(b => { const t = waarde(b); if (t != null && t <= einde && (!best || t < best.t)) best = { boot: b, t }; });
      return best;
    };
    const ev = [];
    const s = eerste(b => startVan(d, b));
    if (s) ev.push(Object.assign(s, { soort: 'start', kop: 'eerste over de startlijn', voor: k => isAchter(d)
      ? k([`${d.naam(s.boot)} gaat als eerste over de startlijn — de achtervolging is begonnen!`,
           `De jacht is geopend: ${d.naam(s.boot)} vertrekt als eerste.`])
      : k([`Eén startschot voor de hele vloot, en ${d.naam(s.boot)} is als eerste over de lijn!`,
           `Na het startschot van ${klokHM(d.raceStart)} is ${d.naam(s.boot)} als eerste over de startlijn.`]) }));
    d.boeien.forEach((bo, i) => {
      const id = boeiId(bo, i), r = eerste(b => d.rounded[b] && d.rounded[b][id]);
      if (r) ev.push(Object.assign(r, { soort: 'boei', kop: `boei ${i + 1} als eerste gerond`, voor: k => k([
        `${d.naam(r.boot)} rondt als eerste boei ${i + 1}.`,
        `Boei ${i + 1} is bereikt: ${d.naam(r.boot)} gaat er als eerste omheen.`]) }));
    });
    const f = eerste(b => finishVan(d, b));
    if (f && d.deelnemers.length > 1) ev.push(Object.assign(f, { soort: 'finish', kop: 'eerste finish', voor: k => isAchter(d)
      ? k([`${d.naam(f.boot)} komt als eerste over de finish en wint de achtervolging! 🏁`,
           `De eerste finish is meteen de winst: ${d.naam(f.boot)} is als eerste binnen! 🏁`])
      : k([`${d.naam(f.boot)} komt als eerste over de finish! 🏁`,
           `De eerste finish is binnen: ${d.naam(f.boot)} haalt als eerste de haven! 🏁`]) }));
    return ev;
  }

  // ---- Wisselingen aan kop (op het water), tot de eerste finish ----
  // Elke minuut kijken wie voorop ligt; een nieuwe koploper telt pas als hij
  // die plek minstens 3 minuten houdt (tegen heen-en-weer door GPS-ruis).
  function kopWissels(d, einde) {
    const uit = [], eersteFinish = Math.min(...d.deelnemers.map(b => finishVan(d, b)).filter(v => v != null), Infinity);
    const tot = Math.min(einde, eersteFinish);
    let huidig = null, kandidaat = null, sinds = 0, teller = 0;
    for (let t = d.raceStart + MINUUT; t <= tot; t += MINUUT) {
      const onderweg = toestand(d, t).filter(v => v.start != null && v.finish == null);
      if (onderweg.length < 2 || onderweg[0].afst == null || onderweg[1].afst == null) continue;
      const kop = onderweg[0].boot;
      if (kop === huidig) { kandidaat = null; teller = 0; continue; }
      if (kop !== kandidaat) { kandidaat = kop; sinds = t; teller = 1; } else teller++;
      if (teller >= 3) {
        if (huidig) {
          const van = huidig, naar = kandidaat;
          uit.push({ t: sinds, boot: naar, soort: 'kop', kop: 'wisseling aan kop', voor: k => k([
            `${d.naam(naar)} neemt de leiding over van ${d.naam(van)}!`,
            `Wisseling aan kop: ${d.naam(naar)} is ${d.naam(van)} voorbij.`]) });
        }
        huidig = kandidaat; kandidaat = null; teller = 0;
      }
    }
    return uit;
  }

  // Maximaal één gebeurtenisnotitie per half uur. Voorrang: eerst de start en de
  // eerste finish, dan de boeien, en wisselingen aan kop alleen nog in de gaten.
  function beperk(primair, extra) {
    const houd = [], rang = e => e.soort === 'start' || e.soort === 'finish' ? 0 : 1;
    const past = e => houd.every(h => Math.abs(h.t - e.t) >= HALF_UUR);
    [...primair].sort((a, b) => rang(a) - rang(b) || a.t - b.t).forEach(e => { if (past(e)) houd.push(e); });
    extra.sort((a, b) => a.t - b.t).forEach(e => { if (past(e)) houd.push(e); });
    return houd;
  }

  function journaal(d) {
    if (!d.raceStart || d.nu < d.raceStart) return [];
    d = Object.assign({}, d);
    d.deelnemers = deelnemers(d);
    const finishes = d.deelnemers.map(b => ({ b, t: finishVan(d, b) })).filter(x => x.t != null);
    const allesBinnen = d.deelnemers.length && finishes.length === d.deelnemers.length ? Math.max(...finishes.map(x => x.t)) : null;
    const einde = allesBinnen != null ? Math.min(d.nu, allesBinnen) : d.nu;
    const uit = [];
    for (let k = 1; d.raceStart + k * UUR <= einde; k++) {
      const t = d.raceStart + k * UUR;
      uit.push({ t, kop: `${klokHM(t)} · ${k} uur onderweg`, soort: 'uur' });
    }
    // Een gebeurtenis binnen 10 minuten van een uurnotitie: samen één notitie (geen dubbele verhalen)
    beperk(eersteGebeurtenissen(d, einde), kopWissels(d, einde)).forEach(e => {
      const u = uit.findIndex(n => n.soort === 'uur' && Math.abs(n.t - e.t) <= 10 * MINUUT);
      const uurKop = u >= 0 ? uit[u].kop.split(' · ')[1] + ' · ' : '';
      if (u >= 0) uit.splice(u, 1);
      uit.push({ t: e.t, kop: `${klokHM(e.t)} · ${uurKop}${e.kop}`, soort: e.soort, voor: e.voor, onderwerp: e.boot, uur: u >= 0 });
    });
    // Slotnotitie: als iedereen binnen is, of als de race is afgerond (ook met boten die niet binnenkwamen)
    if (allesBinnen != null && allesBinnen <= d.nu) {
      const laatste = finishes.sort((a, c) => c.t - a.t)[0].b;
      uit.push({ t: allesBinnen, kop: `${klokHM(allesBinnen)} · de laatste boot is binnen`, soort: 'einde', onderwerp: laatste,
        voor: k => d.deelnemers.length > 1 ? k([`${d.naam(laatste)} komt als laatste over de finish.`,
                                                 `Als laatste meert ${d.naam(laatste)} af: de finish is gehaald.`]) : '' });
    } else if (d.afgerond) {
      uit.push({ t: d.nu, kop: `${klokHM(d.nu)} · de race is afgerond`, soort: 'einde' });
    }
    uit.sort((a, b) => a.t - b.t || (a.soort === 'einde') - (b.soort === 'einde'));
    uit.forEach((n, i) => {
      n.tekst = notitie(d, n.t, { soort: n.soort, voor: n.voor, onderwerp: n.onderwerp, uur: n.uur,
        vorigeT: i ? uit[i - 1].t : null, laatste: i === uit.length - 1 });
      delete n.voor; delete n.soort; delete n.onderwerp; delete n.uur;
    });
    return uit;
  }

  // Een notitie over dít moment (testknop van de wedstrijdleiding)
  function notitieNu(d) {
    if (!d.raceStart) return { t: d.nu, kop: `${klokHM(d.nu)} · test`, tekst: 'Er is nog geen startsein gegeven: de vloot ligt nog in de haven.' };
    if (d.nu < d.raceStart) return { t: d.nu, kop: `${klokHM(d.nu)} · test`,
      tekst: `De vloot wacht op het startschot van ${klokHM(d.raceStart)}. De kanonnen worden geladen…` };
    const eerder = journaal(d);
    const dd = Object.assign({}, d); dd.deelnemers = deelnemers(dd);
    const uur = (d.nu - d.raceStart) / UUR;
    const duur = uur < 1 ? `${Math.round(uur * 60)} min onderweg` : `${uur.toFixed(1).replace('.', ',')} uur onderweg`;
    return { t: d.nu, kop: `${klokHM(d.nu)} · ${duur} · test`,
      tekst: notitie(dd, d.nu, { soort: 'test', vorigeT: eerder.length ? eerder[eerder.length - 1].t : null, laatste: true }) };
  }
  // Wanneer komt de volgende vaste notitie?
  function volgende(d) {
    if (!d.raceStart || d.nu < d.raceStart) return null;
    return d.raceStart + (Math.floor((d.nu - d.raceStart) / UUR) + 1) * UUR;
  }

  // ---- Journaal van een afgeronde race (tab Uitslagen) ----
  // Nieuwe races bewaren hun journaal bij het afronden (res.journaal). Voor oudere
  // races maakt de verteller het achteraf opnieuw uit de bewaarde sporen en tijden;
  // de boeirondingen worden dan uit de sporen herleid (zelfde rondingslijnen als live).
  function rondingenUitSporen(d) {
    const uit = {};
    FLEET.forEach(b => {
      const start = startVan(d, b), pts = d.sporen[b];
      if (start == null || !pts || !d.boeien.length) return;
      const tot = finishVan(d, b), gerond = uit[b] = {};
      let v = 0;
      for (let i = 1; i < pts.length && v < d.boeien.length; i++) {
        if (pts[i].ts < start) continue;
        if (tot != null && pts[i].ts > tot) break;
        const { prev, next } = boeiPrevNext(v, d.boeien, d.lijnen);
        const lijn = rondingsLijn(d.boeien[v], prev, next, RONDINGS_MARGE_MAX_M, RONDINGS_LIJN_M);
        if (lijn && lijnstukkenKruisen(pts[i - 1], pts[i], lijn.a, lijn.b)) { gerond[boeiId(d.boeien[v], v)] = pts[i].ts; v++; }
      }
    });
    return uit;
  }
  function uitArchief(res, naam) {
    if (!res) return { notities: [], achteraf: false };
    if (Array.isArray(res.journaal) || (res.journaal && typeof res.journaal === 'object'))
      return { notities: Object.values(res.journaal).filter(Boolean), achteraf: false };
    if (!res.gun || !res.sporen) return { notities: [], achteraf: true };
    const t0 = res.t0 || res.ts, sporen = {};
    Object.entries(res.sporen).forEach(([b, v]) => {
      sporen[b] = normaliseerSpoor(v).map(p => ({ lat: p[0], lng: p[1], ts: t0 + p[2] * 1000 }));
    });
    // De ratings van toen: gecorrigeerd / verzeild uit de bewaarde uitslag (gelijke start)
    const ratings = {};
    if ((res.modus || 'gelijk') !== 'achtervolging') Object.entries(res.uitslag || {}).forEach(([b, u]) => {
      if (u && u.corrected > 0 && u.elapsed > 0) ratings[b] = u.corrected / u.elapsed;   // niet afronden: tijden moeten kloppen
    });
    const d = { raceStart: res.gun, startPlan: { modus: res.modus || 'gelijk', vertraging: res.vertraging || null },
      times: res.tijden || {}, boeien: alsBoeien(res.baan && res.baan.marks), lijnen: (res.baan && res.baan.lines) || {},
      sporen, naam, wind: null, rounded: {}, afgerond: true, ratings };
    d.rounded = res.rondingen || rondingenUitSporen(d);
    const eindes = FLEET.map(b => finishVan(d, b)).filter(v => v != null)
      .concat(Object.values(sporen).map(p => p.length ? p[p.length - 1].ts : 0));
    d.nu = Math.max(res.gun, ...eindes);
    return { notities: journaal(d), achteraf: true };
  }

  return { journaal, volgende, notitieNu, uitArchief };
})();
