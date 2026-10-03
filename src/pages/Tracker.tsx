// ============================================================
//  Zeilrace — tracker (telefoon op de boot)
//  Stuurt GPS door, detecteert start/boeien/finish, toont de baan,
//  andere boten, wind, een grote aftelklok en een GPS-alarm.
// ============================================================
import L from "leaflet";
import { useConvex } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import { BOTEN, FLEET } from "../../convex/lib/config";
import { SPEL } from "../../convex/lib/spel";
import { useBevestig } from "@/components/Bevestig";
import { GroepBalk } from "@/components/GroepBalk";
import { AftelKlok, spelAftel, type Aftel } from "@/components/AftelKlok";
import { BootKaart } from "@/components/BootKaart";
import { SpelScore } from "@/components/Spel";
import { Voorspelling } from "@/components/Voorspelling";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNu } from "@/hooks/useNu";
import { useGroep } from "@/hooks/useGroep";
import { useSporen } from "@/hooks/useSporen";
import { useWind } from "@/hooks/useWind";
import {
  afgelegdM, akkoordVan, baanVanBoot, bootData, lussenVan, startNaam, tijdOmTeWinnen, vertragingVan, voorspelEindstand, voorspellingVan,
  type TijdenMap,
} from "@/lib/baan";
import { esc, formatAfstand, formatDuur, formatKlok, geleden } from "@/lib/format";
import { GELUID, aftelSchoten, initAudio, kanonschot, speel } from "@/lib/geluid";
import { afstandMeter, heeftLijn, kompas, lijnMidden, peiling, type LatLng } from "@/lib/geo";
import * as Piraat from "@/lib/piraat";
import { KaartVlak } from "@/kaart/KaartVlak";
import { boeiIcoon, grenzenVan, lusIcoon, tekenRondingslijnen, tekenStartFinish, type Meetlat } from "@/kaart/kaart";
import { animeer, ontploffing } from "@/kaart/piraatLagen";
import { SpelLagen, Vloot } from "@/kaart/vloot";
import { Kompas } from "./tracker/Kompas";
import { TrackerMotor } from "./tracker/motor";

type KaartStaat = { kaart: L.Map; vloot: Vloot; spel: SpelLagen; baan: L.Layer[]; doelLijn: L.Polyline | null; afstand: L.Polyline | null; gefit: boolean };

export default function Tracker() {
  const convex = useConvex();
  const { groep, token, race } = useGroep();
  const piraat = groep.piraat;
  const sporen = useSporen(groep.id, token, race.geladen ? race.baan.gen : null);
  const nu = useNu(500);
  const [, setVersie] = useState(0);
  const motor = useMemo(() => new TrackerMotor(convex, groep.id, token, () => setVersie((v) => v + 1)), [convex, groep.id, token]);
  const { baan, boten, posities, spel, naamVan } = race;
  const { lines, marks, raceStart, startPlan, voorstel } = baan;
  const { bevestig } = useBevestig();

  // ---- Keuze van de boot en de teamnaam ----
  // Standaard: de boot die dit toestel al gebruikt, anders een boot die nog vrij is
  const [gekozen, setBoot] = useState<string | null>(null);
  const boot = (gekozen && boten[gekozen] ? gekozen : null)
    ?? race.vloot.find((b) => b.vanMij)?.boot ?? race.vloot.find((b) => !b.geclaimd)?.boot ?? race.vloot[0]?.boot ?? "";
  const [naamInvoer, setNaamInvoer] = useState("");
  const naamGeladen = useRef<string | null>(null);
  useEffect(() => { if (!motor.actief) motor.boot = boot; }, [boot, motor]);
  useEffect(() => {
    if (!race.geladen || motor.actief || naamGeladen.current === boot) return;
    naamGeladen.current = boot;
    setNaamInvoer(boten[boot]?.naam ?? "");
  }, [race.geladen, boot, boten, motor]);
  const [bezig, setBezig] = useState(false);
  // Het kompas (piratenmodus) gaat de eerste keer vanzelf open
  const [kompasOpen, setKompasOpen] = useState(() => { try { return piraat && localStorage.getItem("zeilrace-kompas") !== "1"; } catch { return false; } });

  // ---- De motor de actuele gegevens geven ----
  useEffect(() => { motor.zetData({ baan, boten, posities, spel, naamVan }); }, [motor, baan, boten, posities, spel, naamVan]);
  const ik = motor.actief ? motor.boot : boot;
  const tijdenNu = useMemo<TijdenMap>(() => {
    const t: TijdenMap = {};
    FLEET.forEach((b) => { t[b] = { start: boten[b]?.start ?? null, finish: boten[b]?.finish ?? null }; });
    if (motor.mijnTijden.start != null) t[ik] = { ...t[ik], ...motor.mijnTijden };   // eigen boot: lokaal al actueler
    return t;
  }, [boten, ik, motor.mijnTijden.start, motor.mijnTijden.finish]); // eslint-disable-line react-hooks/exhaustive-deps
  const posTs = useMemo(() => {
    const t: Record<string, number> = {};
    FLEET.forEach((b) => { if (posities[b]) t[b] = posities[b].ts; });
    if (motor.actief && motor.laatsteFix) t[ik] = Math.max(t[ik] || 0, motor.laatsteFix);
    return t;
  }, [posities, ik, motor.actief, Math.floor(nu / 5000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const spelStand = useMemo(() => Piraat.stand(spel, posTs, nu), [spel, posTs, nu]);
  useEffect(() => { motor.spelStand = spelStand; motor.volgSpel(); }, [motor, spelStand]);
  const baanVan = useCallback((b: string) => baanVanBoot(marks, lussenVan(startPlan), b), [marks, startPlan]);

  // ---- Intervallen: waakhond, spel, zichtbaarheid ----
  useEffect(() => {
    const w = setInterval(() => motor.waakhond(), 5000), s = setInterval(() => motor.spelTik(), 1000);
    const z = () => motor.zichtbaarheid(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", z);
    const geluid = () => initAudio();
    document.addEventListener("pointerdown", geluid, { once: true });
    return () => { clearInterval(w); clearInterval(s); document.removeEventListener("visibilitychange", z); document.removeEventListener("pointerdown", geluid); motor.stop(); };
  }, [motor]);

  // ---- Wind op de plek van je boot (of de startlijn) ----
  const windPlek = motor.mijnPositie ?? (heeftLijn(lines.start) ? lijnMidden(lines.start) : null) ?? { lat: 52.4, lng: 5.4 };
  const wind = useWind(windPlek);

  // ---- Voorspelde eindstand ----
  const voorspelRijen = useMemo(() => {
    const t = Date.now(), gerond: Record<string, Record<string, number>> = {}, pos: Record<string, LatLng> = {};
    FLEET.forEach((b) => { gerond[b] = boten[b]?.gerond || {}; if (posities[b]) pos[b] = posities[b]; });
    return raceStart && raceStart <= t ? voorspelEindstand({ times: tijdenNu, gerond, sporen, posities: pos, lijnen: lines, boeien: marks,
      baanVan, raceStart, startPlan, nu: t }) : [];
  }, [Math.floor(nu / 2000), tijdenNu, boten, posities, sporen, lines, marks, baanVan, raceStart, startPlan]); // eslint-disable-line react-hooks/exhaustive-deps

  // =========================================================
  //  Kaart: baan, rondingslijnen, alle boten + zoom/volg-knoppen
  // =========================================================
  const kr = useRef<KaartStaat | null>(null);
  const [kaartKlaar, setKaartKlaar] = useState(false);
  const [volgDoel, setVolgDoel] = useState<string | null>(null);     // 'eigen' | bootnaam | null
  const [afstandTot, setAfstandTot] = useState<string | null>(null);
  const kaartVak = useRef<HTMLDivElement>(null);
  const tip = (t: string) => toast(t, { duration: 3500 });
  const volgRef = useRef<(b: string) => void>(() => {});
  const opKaart = useCallback((kaart: L.Map, _m: Meetlat) => {
    void _m;
    kr.current = { kaart, vloot: new Vloot(kaart, (b) => volgRef.current(b)), spel: new SpelLagen(kaart), baan: [], doelLijn: null, afstand: null, gefit: false };
    kaart.on("dragstart", () => setVolgDoel(null));
    setKaartKlaar(true);
  }, []);
  const fitEen = () => {
    const k = kr.current; if (!k || k.gefit) return;
    const b = grenzenVan([...k.baan, ...k.vloot.lagen()]);
    if (b) { k.kaart.fitBounds(b, { padding: [40, 40], maxZoom: 16 }); k.gefit = true; }
  };
  const volgEigenBoot = () => {
    const p = motor.eigenPos(), k = kr.current;
    if (!p || !k) { tip("Nog geen positie van je boot — druk eerst op Start tracking."); return; }
    setVolgDoel("eigen");
    k.kaart.flyTo([p.lat, p.lng], Math.max(k.kaart.getZoom(), 17), { duration: .8 });
  };
  // Tik op een andere boot (kaart of lijst): een lijn vanaf je eigen boot met de afstand en
  // de richting. Nog een keer tikken op dezelfde boot haalt hem weg.
  const volgBoot = (naam: string) => {
    const s = posities[naam], k = kr.current;
    if (!s || !k) { tip(`${naamVan(naam)} heeft nog geen positie.`); return; }
    if (naam !== ik) {
      if (afstandTot === naam) { setAfstandTot(null); setVolgDoel(null); return; }   // nog een keer: weg
      setAfstandTot(naam);
    }
    setVolgDoel(naam);
    k.kaart.flyTo([s.lat, s.lng], Math.max(k.kaart.getZoom(), 16), { duration: .8 });
    kaartVak.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  volgRef.current = (b) => { if (b !== ik) volgBoot(b); };
  const overzicht = () => {
    const k = kr.current; if (!k) return;
    setVolgDoel(null);
    const b = grenzenVan([...k.baan, ...k.vloot.lagen()]);
    if (b) k.kaart.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
  };

  // ---- De baan: alleen je eigen lus (de lussen van de andere boten doen voor jou niet mee) ----
  useEffect(() => {
    const k = kr.current; if (!k) return;
    const kaart = k.kaart;
    k.baan.forEach((l) => kaart.removeLayer(l)); k.baan = [];
    (["start", "finish"] as const).forEach((t) => {
      const ln = lines[t]; if (!heeftLijn(ln)) return;
      tekenStartFinish(kaart, ln, t, k.baan).bindTooltip(t === "start" ? "START" : "FINISH", { permanent: true, direction: "center", className: "lijn-label" });
    });
    const eigenBaan = baanVan(ik), kleur = BOTEN[ik].kleur;
    tekenRondingslijnen(kaart, eigenBaan, lines, k.baan);       // in de kleur van de boei: hier moet je overheen om te ronden
    eigenBaan.forEach((b) => k.baan.push(L.marker([b.lat, b.lng], { icon: b.lus ? lusIcoon(b.letter || "", kleur) : boeiIcoon((b.nr ?? 1) - 1) })
      .addTo(kaart).bindTooltip(esc(b.label), { direction: "top", offset: [0, -12] })));
    const route: [number, number][] = [];
    if (heeftLijn(lines.start)) { const p = lijnMidden(lines.start); route.push([p.lat, p.lng]); }
    eigenBaan.forEach((b) => route.push([b.lat, b.lng]));
    if (heeftLijn(lines.finish)) { const p = lijnMidden(lines.finish); route.push([p.lat, p.lng]); }
    if (route.length >= 2) k.baan.push(L.polyline(route, { color: "#9fb4cd", weight: 2, dashArray: "3 8", opacity: .8, interactive: false }).addTo(kaart));
    fitEen();
  }, [kaartKlaar, lines, marks, baanVan, ik]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Schepen: eigen schip uit de eigen GPS (actueler), de rest uit de database ----
  const schipLabel = (b: string) => {
    const inSpel = spelStand.start && spelStand.deelnemers.includes(b);
    return esc(naamVan(b)) + (inSpel ? " " + Piraat.levensTekst(spelStand.boten[b]) : "");
  };
  const schipPos = (b: string): LatLng | null => {
    if (b === ik && motor.actief && motor.mijnPositie) return motor.mijnPositie;
    const s = posities[b];
    return s ? { lat: s.lat, lng: s.lng } : null;
  };
  const isSpook = (b: string) => spelStand.bezig && Piraat.spook(spelStand.boten[b], Date.now());
  useEffect(() => {
    const k = kr.current; if (!k) return;
    FLEET.forEach((b) => {
      const eigenGps = b === ik && motor.actief && motor.mijnPositie;
      const d = posities[b];
      if (eigenGps) k.vloot.zetPositie(b, motor.mijnPositie!, motor.mijnKoers, schipLabel(b));
      else if (d) k.vloot.zetPositie(b, d, d.heading != null && (d.speed ?? 0) > 0.4 ? d.heading : null, schipLabel(b));
      else return;
      const p = schipPos(b)!;
      if (volgDoel === b || (volgDoel === "eigen" && b === ik)) k.kaart.panTo([p.lat, p.lng], { animate: true, duration: .5 });
    });
    fitEen();
    // Lijn naar het volgende doel
    const pos = motor.actief ? motor.mijnPositie : null, doel = pos ? motor.volgendDoel(pos) : null;
    if (!pos || !doel) { if (k.doelLijn) { k.kaart.removeLayer(k.doelLijn); k.doelLijn = null; } }
    else {
      const pad: [number, number][] = [[pos.lat, pos.lng], [doel.punt.lat, doel.punt.lng]];
      if (!k.doelLijn) k.doelLijn = L.polyline(pad, { color: "#38d9c8", weight: 3, dashArray: "2 8", interactive: false }).addTo(k.kaart);
      else k.doelLijn.setLatLngs(pad);
    }
  }); // elke render: positie-updates komen via de motor of de database
  useEffect(() => {
    const k = kr.current; if (!k) return;
    FLEET.forEach((b) => k.vloot.zetSpoor(b, sporen[b]));
  }, [kaartKlaar, sporen]);
  // Elke tik: schepen (eigen gloed, wrak, spook), schootslijnen, speelveld, de afstandslijn
  useEffect(() => {
    const k = kr.current; if (!k) return;
    const st = spelStand, spelAan = !!st.start;
    FLEET.forEach((b) => {
      const eigen = b === ik, spook = isSpook(b) ? (eigen ? "half" : "weg") : null;
      k.vloot.zetStaat(b, { eigen, spel: spelAan, spook, wrak: !!(spelAan && st.boten[b].levens <= 0 && st.deelnemers.includes(b)) });
      // Schootslijnen: zichtbaar zolang het speelveld er staat. Tijdens de zeeslag alleen voor
      // schepen die meedoen, nog drijven en niet onzichtbaar zijn (spookschip).
      const aan = st.veld && st.veld.r && (!st.bezig || (st.deelnemers.includes(b) && st.boten[b].levens > 0 && !(!eigen && isSpook(b))));
      k.spel.richtlijn(b, aan ? schipPos(b) : null, eigen && motor.actief ? motor.mijnKoers : k.vloot.koers[b], eigen, st.boten[b].lading);
    });
    // alleen je eigen mijnen
    k.spel.teken(st, spel, nu, st.bezig ? st.mijnen.filter((x) => x.actief && x.boot === ik) : []);
    const mij = motor.eigenPos(), daar = afstandTot ? schipPos(afstandTot) : null;
    if (!afstandTot || afstandTot === ik || !mij || !daar) {
      if (k.afstand) { k.kaart.removeLayer(k.afstand); k.afstand = null; }
    } else {
      const d = afstandMeter(mij, daar), ll: [number, number][] = [[mij.lat, mij.lng], [daar.lat, daar.lng]];
      const tekst = `↔ ${naamVan(afstandTot)}: ${formatAfstand(d)}${d < 1852 ? ` (${Math.round(d)} m)` : ""} ${kompas(peiling(mij, daar))}`;
      if (!k.afstand) k.afstand = L.polyline(ll, { weight: 2, dashArray: "2 6", interactive: false })
        .bindTooltip("", { permanent: true, direction: "center", className: "lijn-label" }).addTo(k.kaart);
      k.afstand.setLatLngs(ll).setStyle({ color: BOTEN[afstandTot].kleur }).setTooltipContent(esc(tekst));
    }
  }, [kaartKlaar, nu]); // eslint-disable-line react-hooks/exhaustive-deps
  // Nieuwe salvo's laten vliegen (niet de oude bij het openen) en ontplofte zeemijnen
  const bekendeSchoten = useRef<Set<string> | null>(null), bekendeKnallen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const k = kr.current; if (!k || !race.geladen) return;
    const st = Piraat.stand(spel, posTs);
    if (bekendeSchoten.current) st.geldig.forEach((g) => {
      if (bekendeSchoten.current!.has(g.id) || Date.now() - g.schot.ts > 20000) return;
      animeer(k.kaart, g.schot, g.raak, schipPos, g.geblokt);
      kanonschot(); setTimeout(() => kanonschot(), 150);
    });
    bekendeSchoten.current = new Set(st.geldig.map((g) => g.id));
    const knallen = st.mijnen.filter((x) => x.knal);
    if (bekendeKnallen.current) knallen.forEach((x) => {
      if (bekendeKnallen.current!.has(x.id) || Date.now() - (x.knal ?? 0) > 20000) return;
      ontploffing(k.kaart, x, x.geblokt ? "🛡️" : "💥");
      kanonschot(true);
    });
    bekendeKnallen.current = new Set(knallen.map((x) => x.id));
  }, [kaartKlaar, race.geladen, spel]); // eslint-disable-line react-hooks/exhaustive-deps

  // =========================================================
  //  Grote aftelklok naar JOUW start, met kanonschoten
  // =========================================================
  const mijnStart = raceStart != null ? raceStart + vertragingVan(startPlan, ik) : null;
  const vorige = useRef<{ spel: number | null; race: number | null }>({ spel: null, race: null });
  useEffect(() => { vorige.current.race = null; }, [raceStart, startPlan]);
  useEffect(() => {
    // Aftellen naar de zeeslag (met dezelfde kanonschoten) gaat voor op de race-klok
    const spelRem = spel?.start ? spel.start - nu : null;
    aftelSchoten(vorige.current.spel, spelRem);
    vorige.current.spel = spelRem;
    if (mijnStart == null) { vorige.current.race = null; return; }
    const rem = mijnStart - nu, v = vorige.current.race;
    if (v != null) {
      if (v > 300000 && rem <= 300000) speel(GELUID.vijfmin);
      if (v > 60000 && rem <= 60000) speel(GELUID.eenmin);
      if (v > 0 && rem <= 0) speel(GELUID.start);
    }
    vorige.current.race = rem;
  }, [nu]); // eslint-disable-line react-hooks/exhaustive-deps
  const aftel: Aftel | null = spelAftel(spel?.start, nu) ?? (() => {
    if (mijnStart == null) return null;
    const rem = mijnStart - nu, achter = startPlan?.modus === "achtervolging", vert = vertragingVan(startPlan, ik);
    if (rem > 0) return { soort: "wacht", urgent: rem <= 60000, laatste10: rem <= 10000, boven: achter ? "JOUW START OVER" : "START OVER",
      cijfers: formatDuur(rem), onder: `om ${formatKlok(mijnStart)}` + (achter ? ` · ${vert ? "achtervolging +" + formatDuur(vert) : "jij start als eerste"}` : "") };
    const doel = motor.volgendDoelLabel();
    return { soort: "gestart", boven: "GESTART", cijfers: formatDuur(-rem), onder: doel ? "➜ volgend doel: " + doel : "gefinisht 🏁" };
  })();

  // ---- Startvoorstel: één glas en trillen bij een nieuw voorstel (niet bij het openen van de pagina) ----
  const bekendVoorstel = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (!race.geladen) return;
    if (bekendVoorstel.current !== undefined && voorstel && voorstel.id !== bekendVoorstel.current && raceStart == null) {
      speel(GELUID.startlijn);
      navigator.vibrate?.([200, 100, 200]);
      motor.meld(`📨 Startvoorstel: ${formatKlok(voorstel.t)}. Geef akkoord op het kaartje hieronder.`, "goed");
    }
    bekendVoorstel.current = voorstel ? voorstel.id : null;
  }, [race.geladen, voorstel, raceStart, motor]);

  // =========================================================
  //  Weergave
  // =========================================================
  const start = async () => {
    if (!boot) return;
    setBezig(true);
    motor.boot = boot;
    let r = await motor.start(naamInvoer);
    if (r?.bezet !== undefined && await bevestig({ titel: `${boten[boot].model} overnemen?`, ok: "Overnemen",
      tekst: `Deze boot is in gebruik${r.bezet ? " door " + r.bezet : ""} op een ander toestel. Wissel je van telefoon, neem hem dan over: het andere toestel stopt dan.` }))
      r = await motor.start(naamInvoer, true);
    setBezig(false);
    setTimeout(() => kr.current?.kaart.invalidateSize(), 250);
  };
  const stop = () => { motor.stop(); setTimeout(() => kr.current?.kaart.invalidateSize(), 250); };
  const akkoordLijst = akkoordVan(voorstel, race.akkoord);
  const t = tijdenNu[ik] || {};
  const eigenS = (() => {
    const uitDb = posities[ik];
    const basis = uitDb ? { ...uitDb } : motor.mijnPositie ? { ...motor.mijnPositie, speed: motor.mijnSnelheid, heading: motor.mijnHeading } : null;
    return basis && { ...basis, start: t.start, finish: t.finish, gerond: motor.actief ? motor.mijnGerond : boten[ik]?.gerond,
      afgelegd: t.start != null ? afgelegdM(sporen[ik], t.start, t.finish) : null,
      win: tijdOmTeWinnen(ik, tijdenNu, raceStart, startPlan, nu), voorspel: voorspellingVan(voorspelRijen, ik) };
  })();
  const w = tijdOmTeWinnen(ik, tijdenNu, raceStart, startPlan, nu);
  const lus = lussenVan(startPlan)?.[ik];

  return (
    <div className="flex min-h-full flex-col">
    <GroepBalk waar="tracker" />
    <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col px-4 pb-[env(safe-area-inset-bottom)]">
      {aftel && <AftelKlok a={aftel} variant="balk" />}

      <header className="pt-1">
        {!motor.actief && <p className="mt-3 mb-1 text-[1.02rem] leading-snug text-muted-foreground">Houd deze pagina open op de boot: scherm aan,
          telefoon aan de lader. Deze telefoon stuurt dan de positie van je boot door.</p>}
        {piraat && <button type="button" title="Het kompas" onClick={() => setKompasOpen(true)}
          className="float-right mt-2 size-[46px] cursor-pointer rounded-full border-2 border-stip bg-[radial-gradient(circle_at_35%_30%,#f7e2a6,#c9a24a_55%,#6e4f18)] text-[1.4rem] shadow-[0_2px_6px_#000a]">🧭</button>}
      </header>

      {!motor.actief && (
        <div>
          <div id="bootKeuze" className="mt-3.5 mb-2 font-kop text-[.9rem] font-extrabold tracking-[.06em] text-kop uppercase">Welke boot ben jij?</div>
          <div role="radiogroup" aria-labelledby="bootKeuze" className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
            {race.vloot.map((b) => (
              <button key={b.boot} type="button" role="radio" aria-checked={b.boot === boot} onClick={() => setBoot(b.boot)}
                className={cn("vlak flex min-h-16 items-center gap-3 rounded-lg border-2 px-3 py-2 text-left",
                  b.boot === boot ? "border-kader ring-4 ring-kader-licht" : "border-rand")}>
                <span className="size-7 shrink-0 rounded-full border-2 border-stip" style={{ background: b.kleur }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg font-bold">{b.naam || b.model}</span>
                  <span className="block text-sm text-muted-foreground">{b.vanMij ? "Op deze telefoon" : b.geclaimd ? `In gebruik${b.claimNaam ? " door " + b.claimNaam : ""}` : b.naam ? b.model : "Vrij"}</span>
                </span>
              </button>
            ))}
          </div>
          <Label htmlFor="naam" className="mt-4 mb-1.5 font-kop text-[.9rem] font-extrabold tracking-[.06em] text-kop uppercase">Teamnaam (optioneel)</Label>
          <Input id="naam" maxLength={24} autoComplete="off" placeholder="bijv. De Zeearend" value={naamInvoer} onChange={(e) => setNaamInvoer(e.target.value)}
            className="h-[54px] bg-card text-[1.15rem] text-card-foreground" />
        </div>
      )}

      <Button variant={motor.actief ? "destructive" : "groen"} disabled={bezig} onClick={motor.actief ? stop : start}
        className="mt-[18px] min-h-[60px] w-full text-[1.2rem] tracking-[.05em]">
        {motor.actief ? "■ Stop tracking" : "▶︎ Start tracking"}</Button>
      <div role="status" className={cn("mt-2.5 min-h-[1.2em] text-[1.02rem] leading-snug font-bold text-kop",
        motor.melding.soort === "goed" && "text-goed-licht", motor.melding.soort === "fout" && "text-destructive")}>{motor.melding.tekst}</div>

      {/* Startvoorstel: elke boot moet akkoord geven */}
      {voorstel && raceStart == null && (() => {
        const verlopen = voorstel.t <= nu, ikEens = akkoordLijst.includes(ik);
        const mijnT = voorstel.t + vertragingVan(voorstel.plan, ik), mijnLus = lussenVan(voorstel.plan)?.[ik];
        return (
          <div className="vlak mt-3.5 rounded-md border-2 border-dashed border-signaal px-4 py-3.5">
            <div className="font-kop text-[1.15rem] font-bold text-signaal">📨 Startvoorstel</div>
            <div className="mt-1 text-[1.1rem] leading-snug">{startNaam(voorstel.plan?.modus)} om {formatKlok(voorstel.t)}
              {verlopen ? " (verlopen)" : ` (over ${formatDuur(voorstel.t - nu)})`}
              {mijnT !== voorstel.t && ` · jouw start ${formatKlok(mijnT)}`}{mijnLus && ` · jouw lus +${formatAfstand(mijnLus.extraM)}`}.</div>
            <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[.98rem] text-muted-foreground">
              {FLEET.map((b) => <span key={b}>{akkoordLijst.includes(b) ? "✔" : "⏳"} {naamVan(b)}</span>)}</div>
            <Button variant="groen" className="mt-3 min-h-14 w-full text-[1.05rem] whitespace-normal" disabled={ikEens || verlopen || !motor.actief}
              onClick={() => motor.akkoord()}>
              {akkoordLijst.length === FLEET.length ? "✔ Iedereen akkoord: de start wordt vastgelegd…"
                : ikEens ? "✔ Je bent akkoord. Wacht op de rest…" : verlopen ? "Voorstel verlopen: wacht op een nieuw voorstel"
                : !motor.actief ? "Start eerst de tracking om akkoord te geven" : "✔ Akkoord met deze starttijd"}</Button>
          </div>
        );
      })()}

      {/* Je eigen boot: hetzelfde kaartje als bij 'Andere boten' */}
      <BootKaart className="mt-3.5" boot={ik} naam={naamVan(ik)} status={motor.actief ? "jij · live" : "jij"} live={motor.actief}
        weergave={bootData(eigenS, lines, baanVan(ik))}>
        {w && <div className="mt-2.5 text-[.98rem] text-muted-foreground italic">{w.rest == null
          ? "Met de gecorrigeerde tijd kun je de boten die binnen zijn niet meer inhalen."
          : `Finish vóór ${formatKlok(w.tot)} om ${w.plek === 1 ? "te winnen" : "plek " + w.plek + " te halen"} (gecorrigeerde tijd).`}</div>}
        {mijnStart != null && <div className="mt-2.5 text-[.98rem] text-muted-foreground italic">
          {startNaam(startPlan?.modus)} · jouw start {formatKlok(mijnStart)}{lus && ` · jouw lus +${formatAfstand(lus.extraM)}`}
          {startPlan?.verwacht?.[ik] ? ` · verwachte tijd ${formatDuur(startPlan.verwacht[ik])}` : ""}</div>}
      </BootKaart>

      {piraat && !!spelStand.start && <SpelPaneel st={spelStand} motor={motor} ik={ik} naamVan={naamVan} nu={nu} tip={tip} />}

      <div ref={kaartVak}>
        <KaartVlak onKaart={opKaart} wind={wind}
          className="mt-3.5 h-[58vh] min-h-[320px] flex-none rounded-md border-3 border-kader shadow-[0_0_0_1px_var(--color-kader-licht),0_4px_14px_#000a]"
          knoppen={[{ id: "volg", tekst: "🎯", titel: "Zoom naar mijn boot en volg hem", klik: volgEigenBoot, actief: volgDoel === "eigen" },
            { id: "overzicht", tekst: "⛶", titel: "Hele baan tonen", klik: overzicht }]} />
      </div>

      {voorspelRijen.length > 0 && (
        <div className="mt-[18px]">
          <div className="font-kop text-[.88rem] font-bold tracking-[.14em] text-kop uppercase">🔮 Voorspelde eindstand</div>
          <div className="mt-0.5 mb-2.5 text-[.95rem] text-muted-foreground italic">Totaal = verzeilde tijd · Gecorr. = met de rating · ≈ voorspeld uit het tempo langs de baan · 🏁 binnen</div>
          <Voorspelling rijen={voorspelRijen} naam={naamVan} eigen={ik} />
        </div>
      )}

      <div className="mt-[18px]">
        <div className="font-kop text-[.88rem] font-bold tracking-[.14em] text-kop uppercase">Andere boten</div>
        <div className="mt-0.5 mb-2.5 text-[.95rem] text-muted-foreground italic">Tik op een boot om hem te volgen op de kaart · 🎯 volgt jouw eigen boot</div>
        <div className="flex flex-col gap-2.5">
          {FLEET.filter((b) => b !== ik).map((b) => {
            const s = posities[b], online = !!s && nu - s.ts < 30000, tb = tijdenNu[b] || {};
            const invoer = s ? { ...s, start: tb.start, finish: tb.finish, gerond: boten[b]?.gerond,
              afgelegd: tb.start != null ? afgelegdM(sporen[b], tb.start, tb.finish) : null,
              win: tijdOmTeWinnen(b, tijdenNu, raceStart, startPlan, nu), voorspel: voorspellingVan(voorspelRijen, b) } : null;
            return <BootKaart key={b} boot={b} naam={naamVan(b)} status={online ? "" : s ? geleden(nu - s.ts) : "geen data"} offline={!online}
              gekozen={volgDoel === b} weergave={bootData(invoer, lines, baanVan(b))} onClick={() => volgBoot(b)} />;
          })}
        </div>
      </div>

      <Collapsible className={cn("vlak mt-4 rounded-md border border-rand px-4 py-3", motor.actief && "border-goed")}>
        <CollapsibleTrigger className="cursor-pointer text-[1.05rem]">
          <span className={cn("mr-2 inline-block size-3 rounded-full bg-muted-foreground align-[-1px]", motor.actief && "knipper bg-goed")} />
          <b>{motor.actief ? "Live: " + naamVan(ik) : "Nog niet gestart"}</b>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2.5 grid grid-cols-2 gap-x-3.5 gap-y-3">
            {[["Positie", motor.mijnPositie ? motor.mijnPositie.lat.toFixed(5) + ", " + motor.mijnPositie.lng.toFixed(5) : "—"],
              ["Nauwkeurigheid", motor.nauwkeurigheid != null ? Math.round(motor.nauwkeurigheid) + " m" : "—"],
              ["Meldingen", motor.meldStatus()]].map(([k, v]) => (
              <div key={k}><div className="font-kop text-[.7rem] font-bold tracking-[.08em] text-muted-foreground uppercase">{k}</div>
                <div className="text-[1.05rem] font-bold">{v}</div></div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
      <div className="h-6" />

      {motor.gpsAlarm && (
        <button type="button" role="alert" onClick={() => motor.alarmStilte()}
          className="alarmpuls fixed right-3 bottom-[calc(12px+env(safe-area-inset-bottom))] left-3 z-[2000] rounded-lg border-3 border-white bg-destructive p-4 text-center font-kop text-[1.25rem] font-black text-white shadow-[0_8px_30px_#000c]">
          ⚠️ {motor.gpsAlarm.titel}
          <small className="mt-1 block font-sans text-[.98rem] font-bold">{motor.gpsAlarm.uitleg} · tik om het geluid te stoppen</small>
        </button>
      )}

      {piraat && <Kompas open={kompasOpen} setOpen={setKompasOpen} bron={{
        hier: () => motor.mijnPositie,
        doel: (p) => motor.volgendDoel(p)?.punt ?? null,
        gpsKoers: () => motor.actief && motor.mijnKoers != null ? motor.mijnKoers : null,
      }} />}
    </div>
    </div>
  );
}

// =========================================================
//  Het piratenspel op de tracker: vuur het kanon!
// =========================================================
function SpelPaneel({ st, motor, ik, naamVan, nu, tip }: {
  st: Piraat.SpelStand; motor: TrackerMotor; ik: string; naamVan: (b: string) => string; nu: number; tip: (t: string) => void;
}) {
  const mij = st.boten[ik], actief = motor.actief;
  const herlaad = Math.max(0, motor.herlaadKlaar(mij) - nu), stil = Math.max(0, motor.stilKlaar(mij) - nu);
  const val = mij.valTot > nu && mij.valTot >= motor.geraaktKlaar(mij);
  const wacht = (ms: number) => formatDuur(Math.ceil(ms / 1000) * 1000), effecten = Piraat.effectenTekst(mij, nu);
  const kanNiet = !st.bezig || !actief || mij.levens <= 0 || mij.gebruikt >= SPEL.schoten || herlaad > 0 || stil > 0;
  const tekst = st.wacht ? `⏳ De zeeslag begint om ${formatKlok(st.start)}` : !st.bezig ? "⚓ De zeeslag is voorbij" : mij.levens <= 0 ? "☠️ Gezonken"
    : mij.gebruikt >= SPEL.schoten ? "🪣 Het kruit is op"
    : stil > 0 ? (val ? `🪤 Boobytrap! Kanon onklaar… ${wacht(Math.max(stil, herlaad))}` : `💫 Geraakt! Kanon ligt stil… ${wacht(Math.max(stil, herlaad))}`)
    : herlaad > 0 ? `⏳ Herladen… ${wacht(herlaad)}`
    : mij.lading === "bereik" ? `💥 Vuur het kanon! (🔭 ${Piraat.bereik({ groot: true })} m)`
    : mij.lading === "breed" ? "💥 Vuur het kanon! (↔️ breed)"
    : mij.lading === "voor" ? "💥 Vuur het kanon! (⬆️ + voorkanon)" : "💥 Vuur het kanon!";
  // Buiten het speelveld? (de motor telt af tot het leven kost)
  const buiten = motor.buitenSinds != null ? Math.max(0, Math.ceil((SPEL.strafMs - (nu - motor.buitenSinds)) / 1000)) : null;
  const vuurKlassen = "mt-2.5 mb-1 block min-h-[70px] w-full cursor-pointer rounded-lg border-2 border-[#3d0d07] font-titel text-[2rem] tracking-[.02em] text-[#fff4e2] [text-shadow:0_2px_0_#000] active:enabled:translate-y-[3px] disabled:cursor-default disabled:opacity-60 disabled:grayscale-[.8]";
  return (
    <section className="vlak mt-3.5 rounded-md border-2 border-signaal px-3.5 py-3">
      <div className="font-titel text-[1.7rem] leading-[1.1] text-signaal">🏴‍☠️ Het Piratenspel</div>
      <div className="mt-0.5 mb-2 text-muted-foreground italic">{Piraat.statusTekst(st, naamVan)}</div>
      <div className="mt-1.5 mb-1 font-kop text-[1.05rem] font-bold">
        {!actief ? "Start de tracking om mee te vechten." : `${naamVan(ik)}: ${Piraat.levensTekst(mij)} · ${SPEL.schoten - mij.gebruikt} salvo's · ${mij.hits} raak`}
        {actief && effecten && mij.levens > 0 && <div className="mt-0.5 font-sans text-[.95rem] font-normal">{effecten}</div>}
      </div>
      {buiten != null && (
        <div className="knipper my-2 rounded-md border-2 border-destructive bg-[linear-gradient(180deg,#7a1d12,#5a130b)] px-3 py-2.5 text-center font-bold text-[#ffe9dc]">
          ⚠️ Buiten het speelveld! Keer om: over {buiten} s kost het een leven.</div>
      )}
      <button type="button" disabled={kanNiet} onClick={() => motor.vuur(tip)}
        className={cn(vuurKlassen, "bg-[radial-gradient(ellipse_at_50%_30%,#d0542f,#8b1e12_70%)] shadow-[inset_0_2px_0_#f0a070,0_4px_0_#2a0804,0_6px_16px_rgba(0,0,0,.5)]")}>{tekst}</button>
      {st.bezig && actief && mij.levens > 0 && mij.lading === "mijn" && (
        <button type="button" onClick={() => motor.legMijn(tip)}
          className={cn(vuurKlassen, "min-h-[54px] bg-[radial-gradient(ellipse_at_50%_30%,#5b4a3a,#2b1b0d_70%)] text-[1.5rem] shadow-[inset_0_2px_0_#8a7560,0_4px_0_#120a04,0_6px_16px_rgba(0,0,0,.5)]")}>💣 Leg een zeemijn</button>
      )}
      <SpelScore st={st} naam={naamVan} eigen={ik} />
    </section>
  );
}
