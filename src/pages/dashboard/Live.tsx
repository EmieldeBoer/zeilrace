// ============================================================
//  Dashboard, tab Live: de kaart en het paneel met de boten, de
//  voorspelling, het piratenspel, de wedstrijdleiding, het
//  scheepsjournaal en de baanplanning.
// ============================================================
import L from "leaflet";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { BOTEN, FLEET } from "../../../convex/lib/config";
import { SPEL } from "../../../convex/lib/spel";
import type { Boei, Lijnen, StartPlan, Veld } from "../../../convex/lib/validators";
import { AftelKlok, spelAftel, type Aftel } from "@/components/AftelKlok";
import { BootKaart } from "@/components/BootKaart";
import { useBevestig } from "@/components/Bevestig";
import { BuitLijst, SpelScore } from "@/components/Spel";
import { Voorspelling } from "@/components/Voorspelling";
import { Alert } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { RaceData } from "@/hooks/useRace";
import { useWind } from "@/hooks/useWind";
import type { Wl } from "@/hooks/useWl";
import {
  afgelegdM, baanLengteNm, baanVanBoot, bootData, eigenStartVan, gecorrigeerdeTijd, lussenVan, maakLusPlan, maakPlan,
  startNaam, tijdOmTeWinnen, vertragingVan, voorspelEindstand, voorspellingVan, akkoordVan, type SpoorPunt,
} from "@/lib/baan";
import { Feest } from "@/lib/feest";
import { foutTekst } from "@/lib/fouten";
import { dunUit, esc, formatAfstand, formatDuur, formatKlok, geleden, klokHM, zmTekst } from "@/lib/format";
import { GELUID, aftelSchoten, kanonschot, speel } from "@/lib/geluid";
import { afstandMeter, boeiId, heeftLijn, lijnMidden, snapLijnPunt, type LatLng } from "@/lib/geo";
import * as Piraat from "@/lib/piraat";
import { windUren } from "@/lib/polar";
import { racePlek, raceEinde, zonderLeeg } from "@/lib/uitslag";
import * as Verteller from "@/lib/verteller";
import { KaartVlak } from "@/kaart/KaartVlak";
import { boeiIcoon, grenzenVan, LIJN_KLEUR, tekenLussen, tekenRondingslijnen, tekenStartFinish, type Meetlat } from "@/kaart/kaart";
import { animeer, ontploffing } from "@/kaart/piraatLagen";
import { SpelLagen, Vloot } from "@/kaart/vloot";
import { Journaal } from "./Journaal";
import { Planning } from "./Planning";
import { WlLogin, WlPaneel, type WlTab } from "./WlPaneel";

export type Concept = { lines: Lijnen; marks: (Boei & { id: string })[] };
export type InstelModus = null | "start" | "finish" | "boei" | "weg";
const nieuwId = () => "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const MIN_VOORSTEL_MS = 2 * 60 * 1000;      // een voorstel ligt minstens 2 minuten in de toekomst
// Voorgestelde starttijd: het eerste 5-minutenmoment minstens 10 minuten vanaf nu
function voorgesteldeStartTijd(nu: number) {
  const stap = 5 * 60 * 1000;
  return Math.ceil((nu + 2 * stap) / stap) * stap;
}
const lijnUitleg = ": het eerste punt is vrij, het tweede snapt naar een windstreek (N, NO, O, …) en een lengte van 0,5, 1, 1,5 … zm.";

type KaartStaat = { kaart: L.Map; meetlat: Meetlat; vloot: Vloot; spel: SpelLagen; baan: L.Layer[]; tijdelijk: L.Layer[]; snap: L.Polyline | null };

export function Live({ race, sporen, wl, wlModus, nu, actief }: {
  race: RaceData; sporen: Record<string, SpoorPunt[]>; wl: Wl; wlModus: boolean; nu: number; actief: boolean;
}) {
  const { baan, posities, spel, times, gerond, akkoord, naamVan } = race;
  const { lines, marks, raceStart, startPlan, voorstel } = baan;
  const admin = wl.isWl, wlZicht = wlModus && admin;
  const { bevestig } = useBevestig();

  // ---- Toestand ----
  const [geselecteerd, setGeselecteerd] = useState<string | null>(null);
  const [concept, setConcept] = useState<Concept | null>(null);
  const [instelModus, setInstelModus] = useState<InstelModus>(null);
  const [veldModus, setVeldModus] = useState(false);
  const [wlTab, setWlTabState] = useState<WlTab>(() => {
    try { return (localStorage.getItem("zeilrace-wl-tab") as WlTab) || "baan"; } catch { return "baan"; }
  });
  const setWlTab = (t: WlTab) => { setWlTabState(t); try { localStorage.setItem("zeilrace-wl-tab", t); } catch { /* */ } };
  const [wlStatus, setWlStatus] = useState<string | null>(null);
  const [startTijd, setStartTijd] = useState("");
  const [testNotities, setTestNotities] = useState<Verteller.JournaalNotitie[]>([]);
  const [bezig, setBezig] = useState(false);

  const kr = useRef<KaartStaat | null>(null);
  const [kaartKlaar, setKaartKlaar] = useState(false);
  const huidigeBaan = useMemo<Concept | { lines: Lijnen; marks: Boei[] }>(() => concept || { lines, marks }, [concept, lines, marks]);
  const baanVan = useCallback((b: string) => baanVanBoot(marks, lussenVan(startPlan), b), [marks, startPlan]);

  // ---- Wind (midden van de startlijn, anders de eerste boot) ----
  const eersteBoot = FLEET.find((b) => posities[b]);
  const windPlek = useMemo<LatLng>(() => heeftLijn(huidigeBaan.lines.start) ? lijnMidden(huidigeBaan.lines.start)
    : eersteBoot ? { lat: posities[eersteBoot].lat, lng: posities[eersteBoot].lng } : { lat: 52.4, lng: 5.4 },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [huidigeBaan.lines.start, eersteBoot]);
  const wind = useWind(windPlek);
  const windKn = typeof wind === "object" ? wind.kn : null, windRichting = typeof wind === "object" ? wind.richting : null;

  // ---- Afgeleid: piratenspel, voorspelling ----
  const posTs = useMemo(() => Object.fromEntries(FLEET.filter((b) => posities[b]).map((b) => [b, posities[b].ts])), [posities]);
  const spelStand = useMemo(() => Piraat.stand(spel, posTs, nu), [spel, posTs, nu]);
  const spookStaat = useCallback((b: string): "half" | "weg" | null => {
    if (!(spelStand.bezig && Piraat.spook(spelStand.boten[b], nu))) return null;
    return wlZicht ? "half" : "weg";
  }, [spelStand, nu, wlZicht]);
  const isWrak = (b: string) => !!(spelStand.start && spelStand.deelnemers.includes(b) && spelStand.boten[b].levens <= 0);
  const schipLabel = useCallback((b: string) => {
    const inSpel = spelStand.start && spelStand.deelnemers.includes(b);
    return esc(naamVan(b)) + (inSpel ? " " + Piraat.levensTekst(spelStand.boten[b]) : "");
  }, [spelStand, naamVan]);
  const voorspelRijen = useMemo(() => raceStart && raceStart <= nu ? voorspelEindstand({ times, gerond, sporen,
    posities, lijnen: lines, boeien: marks, baanVan, raceStart, startPlan, nu }) : [],
  [raceStart, nu, times, gerond, sporen, posities, lines, marks, baanVan, startPlan]);

  // ---- Mutaties van de wedstrijdleiding ----
  const m = {
    baan: useMutation(api.wl.baan), voorstel: useMutation(api.wl.stelStartVoor), voorstelWeg: useMutation(api.wl.trekVoorstelIn),
    gerond: useMutation(api.wl.gerond), rondAf: useMutation(api.wl.rondAf), wisLive: useMutation(api.wl.wisLive),
    vrijgeven: useMutation(api.wl.vrijgeven), veld: useMutation(api.wl.veld), spelStart: useMutation(api.wl.spelStart),
    spelStop: useMutation(api.wl.spelStop), zeeslag: useMutation(api.wl.zeeslagOpslaan),
  };
  const token = wl.token;
  const doe = useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) setWlStatus(ok); return true; } catch (e) { setWlStatus("Mislukt: " + foutTekst(e)); return false; }
  }, []);
  // Ligt de start vast: weer de standaardtekst (die dat meldt)
  useEffect(() => { if (raceStart != null) setWlStatus(null); }, [raceStart]);

  // =========================================================
  //  Kaart
  // =========================================================
  const selecteerRef = useRef<(b: string, vanKaart?: boolean) => void>(() => {});
  const opKaart = useCallback((kaart: L.Map, meetlat: Meetlat) => {
    kr.current = { kaart, meetlat, vloot: new Vloot(kaart, (b) => selecteerRef.current(b, true)), spel: new SpelLagen(kaart),
      baan: [], tijdelijk: [], snap: null };
    kaart.on("dragstart", () => setGeselecteerd(null));
    setKaartKlaar(true);
  }, []);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selecteerBoot = (naam: string, vanKaart?: boolean) => {
    if (geselecteerd === naam && !vanKaart) { setGeselecteerd(null); return; }
    setGeselecteerd(naam);
    const d = posities[naam], k = kr.current;
    if (!d || !k) return;
    k.kaart.flyTo([d.lat, d.lng], Math.max(k.kaart.getZoom(), 16), { duration: .8 });
    if (!vanKaart && window.matchMedia("(max-width: 820px)").matches) wrapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  selecteerRef.current = selecteerBoot;
  const overzicht = () => {
    const k = kr.current; if (!k) return;
    setGeselecteerd(null);
    const b = grenzenVan([...k.baan, ...k.vloot.lagen()]);
    if (b) k.kaart.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
  };
  // De tab Live weer zichtbaar: Leaflet de nieuwe maat laten weten
  useEffect(() => { if (actief) setTimeout(() => kr.current?.kaart.invalidateSize(), 30); }, [actief]);

  // ---- Baan tekenen (gepubliceerd, of het concept van de wedstrijdleiding) ----
  useEffect(() => {
    const k = kr.current; if (!k) return;
    const kaart = k.kaart;
    k.baan.forEach((l) => kaart.removeLayer(l)); k.baan = [];
    const { lines: ls, marks: ms } = huidigeBaan, isConcept = !!concept;
    (["start", "finish"] as const).forEach((t) => {
      const ln = ls[t]; if (!heeftLijn(ln)) return;
      // bij een gesnapte lijn in het concept ook de windstreek en de lengte (ook zichtbaar op een telefoon)
      const s = isConcept ? snapLijnPunt(ln.a, ln.b) : null;
      const maat = s && afstandMeter(s.punt, ln.b) < 2 ? ` · ${s.streek} ${zmTekst(s.zm)}` : "";
      tekenStartFinish(kaart, ln, t, k.baan, { weight: isConcept ? 5 : 4, dashArray: isConcept ? "3 7" : "7 7" })
        .bindTooltip((isConcept ? "✎ " : "") + (t === "start" ? "START" : "FINISH") + maat, { permanent: true, direction: "center", className: "lijn-label" });
    });
    const lussen = lussenVan(startPlan);
    if (admin) {                                                        // alleen voor de wedstrijdleiding
      tekenRondingslijnen(kaart, ms, ls, k.baan);
      if (lussen) FLEET.forEach((b) => tekenRondingslijnen(kaart, baanVanBoot(ms, lussen, b), ls, k.baan, BOTEN[b].kleur, (x) => !!x.lus));
    }
    tekenLussen(kaart, ms, ls, lussen, k.baan, naamVan);
    // Wedstrijdleiding in de tab Race: laat zien waar de lussen van start C zouden komen
    if (!lussen && wlZicht && wlTab === "race") {
      const lp = maakLusPlan(ls, ms);
      if (lp) tekenLussen(kaart, ms, ls, lp.lussen, k.baan, naamVan, true);
    }
    ms.forEach((b, i) => {
      const mk = L.marker([b.lat, b.lng], { icon: boeiIcoon(i, isConcept), draggable: isConcept && instelModus !== "weg" })
        .addTo(kaart).bindTooltip(esc(b.naam || "Boei " + (i + 1)), { direction: "top", offset: [0, -12] });
      if (isConcept) {
        mk.on("dragend", (e) => {
          const ll = (e.target as L.Marker).getLatLng();
          setConcept((c) => c && { ...c, marks: c.marks.map((x, j) => j === i ? { ...x, lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6) } : x) });
          setWlStatus(`Boei ${i + 1} verplaatst (concept).`);
        });
        mk.on("click", () => {
          if (instelModus !== "weg") return;
          setConcept((c) => c && { ...c, marks: c.marks.filter((_, j) => j !== i) });
          setWlStatus(`Boei ${i + 1} weggehaald (concept). Tik nog een boei, of druk op de knop om te stoppen.`);
        });
      }
      k.baan.push(mk);
    });
    const route: [number, number][] = [];
    if (heeftLijn(ls.start)) { const p = lijnMidden(ls.start); route.push([p.lat, p.lng]); }
    ms.forEach((b) => route.push([b.lat, b.lng]));
    if (heeftLijn(ls.finish)) { const p = lijnMidden(ls.finish); route.push([p.lat, p.lng]); }
    if (route.length >= 2) k.baan.push(L.polyline(route,
      { color: isConcept ? "#ffe08a" : "#9fb4cd", weight: 2, dashArray: "3 8", opacity: .85, interactive: false }).addTo(kaart));
  }, [kaartKlaar, huidigeBaan, concept, admin, wlZicht, wlTab, startPlan, instelModus, naamVan]);

  // ---- Klikken op de kaart: baan uitzetten en het speelveld tekenen ----
  const klikStaat = useRef({ admin, concept, instelModus, veldModus });
  klikStaat.current = { admin, concept, instelModus, veldModus };
  const veldMidden = useRef<{ p: LatLng; marker: L.CircleMarker } | null>(null);
  const tijdPunten = useRef<LatLng[]>([]);
  const wisTijdelijk = useCallback(() => {
    const k = kr.current; if (!k) return;
    k.tijdelijk.forEach((l) => k.kaart.removeLayer(l)); k.tijdelijk = []; tijdPunten.current = [];
    if (k.snap) { k.kaart.removeLayer(k.snap); k.snap = null; }
  }, []);
  const zetModus = useCallback((modus: InstelModus, tekst?: string) => {
    setInstelModus(modus); wisTijdelijk();
    if (tekst) setWlStatus(tekst);
  }, [wisTijdelijk]);

  useEffect(() => {
    const k = kr.current; if (!k) return;
    const kaart = k.kaart;
    const opKlik = async (e: L.LeafletMouseEvent) => {
      const s = klikStaat.current;
      if (!s.admin || k.meetlat.actief()) return;
      let p = { lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) };
      if (s.veldModus) { await klikVeld(p, e.latlng); return; }
      if (!s.concept || !s.instelModus) return;
      if (s.instelModus === "boei") {
        const n = s.concept.marks.length + 1;
        setConcept((c) => c && { ...c, marks: [...c.marks, { id: nieuwId(), ...p }] });
        setWlStatus(`Boei ${n} geplaatst (concept). Tik nog een boei, of druk op de knop om te stoppen.`);
      } else if (s.instelModus === "start" || s.instelModus === "finish") {
        // het eerste punt is vrij, het tweede snapt naar een windstreek en een hele of halve zeemijl
        const snap = tijdPunten.current.length === 1 ? snapLijnPunt(tijdPunten.current[0], p) : null;
        if (snap) p = snap.punt;
        tijdPunten.current.push(p);
        k.tijdelijk.push(L.circleMarker([p.lat, p.lng], { radius: 6, color: "#fff", weight: 2, fillColor: "#ffe08a", fillOpacity: 1 }).addTo(kaart));
        if (!snap) setWlStatus("Eerste punt gezet. Tik het tweede punt: de lijn snapt naar N, NO, O, … en een lengte van 0,5, 1, 1,5 … zm.");
        if (tijdPunten.current.length === 2 && snap) {
          const t = s.instelModus, [a, b] = tijdPunten.current;
          // Een nieuwe start- of finishlijn = een nieuwe baan: de boeien gaan eruit
          const weg = s.concept.marks.length;
          setConcept((c) => c && { lines: { ...c.lines, [t]: { a, b } }, marks: [] });
          zetModus(null);
          setWlStatus(`${t === "start" ? "Startlijn" : "Finishlijn"} aangepast: ${snap.streek}, ${zmTekst(snap.zm)} (concept)` +
            (weg ? ` en ${weg === 1 ? "de boei is" : "alle " + weg + " boeien zijn"} weggehaald — zet ze opnieuw uit.` : ".") +
            " Vergeet niet te bevestigen.");
        }
      }
    };
    // Voorbeeld van de gesnapte lijn onder de muis, na het eerste punt
    const opBeweeg = (e: L.LeafletMouseEvent) => {
      const s = klikStaat.current;
      if (!(s.instelModus === "start" || s.instelModus === "finish") || tijdPunten.current.length !== 1) {
        if (k.snap) { kaart.removeLayer(k.snap); k.snap = null; }
        return;
      }
      const a = tijdPunten.current[0], sp = snapLijnPunt(a, e.latlng);
      const lijn: [number, number][] = [[a.lat, a.lng], [sp.punt.lat, sp.punt.lng]];
      if (!k.snap) k.snap = L.polyline(lijn, { color: LIJN_KLEUR[s.instelModus], weight: 3, dashArray: "4 6", opacity: .8, interactive: false })
        .bindTooltip("", { permanent: true, direction: "top", className: "lijn-label" }).addTo(kaart);
      k.snap.setLatLngs(lijn).setTooltipContent(`${sp.streek} · ${zmTekst(sp.zm)}`);
    };
    kaart.on("click", opKlik); kaart.on("mousemove", opBeweeg);
    return () => { kaart.off("click", opKlik); kaart.off("mousemove", opBeweeg); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kaartKlaar]);

  // Speelveld tekenen: tik het midden (standaardstraal) of daarna zelf de rand
  async function klikVeld(p: LatLng, ll: L.LatLng) {
    const k = kr.current!;
    let r: number, midden: LatLng;
    if (!veldMidden.current) {
      if (await bevestig({ titel: "Speelveld met de standaardstraal?", ok: "Ja, standaard",
        annuleer: "Zelf de rand tikken",
        tekst: `Een cirkel met een straal van ${formatAfstand(SPEL.veldStandaardM)} (${SPEL.veldStandaardM} m) rond dit punt.` })) {
        midden = p; r = SPEL.veldStandaardM;
      } else {
        veldMidden.current = { p, marker: L.circleMarker(ll, { radius: 6, color: "#fff", weight: 2, fillColor: "#8b1e12", fillOpacity: 1 }).addTo(k.kaart) };
        setWlStatus("Tik nu de RAND van het speelveld…");
        return;
      }
    } else { r = Math.round(afstandMeter(veldMidden.current.p, p)); midden = veldMidden.current.p; }
    setVeldModus(false);
    if (veldMidden.current) { k.kaart.removeLayer(veldMidden.current.marker); veldMidden.current = null; }
    if (r < 50) { setWlStatus("Dat speelveld is te klein — probeer het opnieuw."); return; }
    if (r !== SPEL.veldStandaardM && !(await bevestig({ titel: "Speelveld opslaan?", tekst: `Een cirkel met een straal van ${formatAfstand(r)}.` }))) {
      setWlStatus("Speelveld niet opgeslagen."); return;
    }
    const veld: Veld = { lat: midden.lat, lng: midden.lng, r };
    await doe(() => m.veld({ token, veld }), `Speelveld opgeslagen (straal ${formatAfstand(r)}).`);
  }

  // ---- Schepen en sporen ----
  const eersteFix = useRef(true);
  useEffect(() => {
    const k = kr.current; if (!k) return;
    FLEET.forEach((b) => {
      const d = posities[b]; if (!d) return;
      k.vloot.zetPositie(b, d, d.heading != null && (d.speed ?? 0) > 0.4 ? d.heading : null, schipLabel(b));
      if (geselecteerd === b) k.kaart.panTo([d.lat, d.lng], { animate: true });
      if (eersteFix.current) { k.kaart.setView([d.lat, d.lng], 14); eersteFix.current = false; }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kaartKlaar, posities]);
  useEffect(() => {
    const k = kr.current; if (!k) return;
    FLEET.forEach((b) => k.vloot.zetSpoor(b, sporen[b]));
  }, [kaartKlaar, sporen]);
  // Elke seconde: labels (levens), wrakken, spookschepen, schootslijnen en het speelveld
  useEffect(() => {
    const k = kr.current; if (!k) return;
    const st = spelStand;
    FLEET.forEach((b) => {
      k.vloot.zetLabel(b, schipLabel(b));
      k.vloot.zetStaat(b, { gekozen: geselecteerd === b, wrak: isWrak(b), spel: !!st.start, spook: spookStaat(b) });
      // Schootslijnen: zichtbaar zolang het speelveld er staat. Tijdens de zeeslag alleen voor
      // schepen die meedoen, nog drijven en niet onzichtbaar zijn (spookschip).
      const aan = st.veld && st.veld.r && (!st.bezig || (st.deelnemers.includes(b) && st.boten[b].levens > 0 && spookStaat(b) !== "weg"));
      const pos = posities[b];
      k.spel.richtlijn(b, aan && pos ? pos : null, k.vloot.koers[b], false, st.boten[b].lading);
    });
    // zeemijnen: alleen de wedstrijdleiding ziet ze liggen
    k.spel.teken(st, spel, nu, st.bezig && wlZicht ? st.mijnen.filter((x) => x.actief) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kaartKlaar, nu, spelStand, geselecteerd, posities]);

  // Nieuwe salvo's laten vliegen en ontplofte zeemijnen laten knallen (niet de oude bij het openen)
  const bekendeSchoten = useRef<Set<string> | null>(null), bekendeKnallen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const k = kr.current; if (!k || race.spel === undefined) return;
    const st = Piraat.stand(spel, posTs);
    const schipPos = (b: string) => posities[b] ? { lat: posities[b].lat, lng: posities[b].lng } : null;
    if (bekendeSchoten.current) st.geldig.forEach((g) => {
      if (bekendeSchoten.current!.has(g.id) || Date.now() - g.schot.ts > 20000) return;
      animeer(k.kaart, g.schot, g.raak, schipPos, g.geblokt);
      kanonschot();
    });
    bekendeSchoten.current = new Set(st.geldig.map((g) => g.id));
    const knallen = st.mijnen.filter((x) => x.knal);
    if (bekendeKnallen.current) knallen.forEach((x) => {
      if (bekendeKnallen.current!.has(x.id) || Date.now() - (x.knal ?? 0) > 20000) return;
      ontploffing(k.kaart, x, x.geblokt ? "🛡️" : "💥");
      kanonschot(true);
    });
    bekendeKnallen.current = new Set(knallen.map((x) => x.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kaartKlaar, spel]);

  // =========================================================
  //  Tijden, finish-feest, alarmen en kanonschoten
  // =========================================================
  const berekenUitslag = useCallback((t = Date.now()) => FLEET.map((naam) => {
    const x = times[naam] || {};
    const eigenStart = eigenStartVan(naam, x, raceStart, startPlan);
    let elapsed: number | null = null, corrected: number | null = null, gefinisht = false;
    if (x.start != null && eigenStart != null) {
      gefinisht = x.finish != null;
      const eind = gefinisht ? x.finish! : t;
      elapsed = eind - eigenStart;
      corrected = gecorrigeerdeTijd(naam, eind, raceStart, startPlan, eigenStart);
    }
    return { naam, gefinisht, elapsed, corrected };
  }), [times, raceStart, startPlan]);
  // Vuurwerk zodra een boot binnenkomt (niet voor finishes die er al waren bij het laden)
  const bekendeFinishes = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!race.geladen) return;
    const binnen = new Set(FLEET.filter((b) => times[b]?.finish != null));
    if (bekendeFinishes.current) binnen.forEach((b) => {
      if (bekendeFinishes.current!.has(b)) return;
      const r = berekenUitslag().find((x) => x.naam === b);
      Feest.start({ titel: `🏁 ${naamVan(b)} is binnen!`,
        sub: r && r.elapsed != null ? `Verzeild ${formatDuur(r.elapsed)} · gecorrigeerd ${formatDuur(r.corrected)}` : "" });
    });
    bekendeFinishes.current = binnen;
  }, [race.geladen, times, berekenUitslag, naamVan]);

  // Alarm voor de wedstrijdleiding: boot zonder GPS tijdens de race
  const alarmen = wlZicht ? FLEET.filter((b) => {
    const t = times[b] || {}, ts = posities[b]?.ts;
    return t.start != null && t.finish == null && ts && nu - ts > 30000;
  }) : [];
  const alarmActief = useRef<Set<string>>(new Set());
  useEffect(() => {
    alarmen.forEach((b) => { if (!alarmActief.current.has(b)) speel(GELUID.alarm); });
    alarmActief.current = new Set(alarmen);
  }, [alarmen.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Aftelklok over de kaart; de wedstrijdleiding hoort de kanonschoten (5 min, 1 min, start)
  const momenten = raceStart ? FLEET.map((b) => ({ b, t: raceStart + vertragingVan(startPlan, b) })).sort((x, y) => x.t - y.t) : [];
  const vorigeRem = useRef<{ spel: number | null; per: Record<number, number> }>({ spel: null, per: {} });
  useEffect(() => {
    const spelRem = spel?.start ? spel.start - nu : null;
    if (wlZicht) aftelSchoten(vorigeRem.current.spel, spelRem);
    vorigeRem.current.spel = spelRem;
    if (wlZicht) [...new Set(momenten.map((x) => x.t))].forEach((t) => {
      const rem = t - nu, v = vorigeRem.current.per[t];
      if (v != null) {
        if (v > 300000 && rem <= 300000) speel(GELUID.vijfmin);
        if (v > 60000 && rem <= 60000) speel(GELUID.eenmin);
        if (v > 0 && rem <= 0) speel(GELUID.start);
      }
      vorigeRem.current.per[t] = rem;
    });
  }, [nu]); // eslint-disable-line react-hooks/exhaustive-deps
  const aftel: Aftel | null = spelAftel(spel?.start, nu) ?? (() => {
    if (!raceStart) return null;
    const achter = startPlan?.modus === "achtervolging", volgende = momenten.find((x) => x.t > nu);
    if (volgende) {
      const rem = volgende.t - nu, wie = momenten.filter((x) => x.t === volgende.t).map((x) => naamVan(x.b)).join(" + ");
      return { soort: "wacht", urgent: rem <= 60000, laatste10: rem <= 10000,
        boven: achter ? "START " + wie.toUpperCase() + " OVER" : "START OVER", cijfers: formatDuur(rem),
        onder: <>om {formatKlok(volgende.t)}{achter && <div className="mt-1 font-sans text-[clamp(.85rem,2vw,1rem)] font-normal tracking-normal text-ivoor-zacht">
          {momenten.map((x) => `${x.t <= nu ? "✓ " : ""}${naamVan(x.b)} ${formatKlok(x.t)}`).join(" · ")}</div>}</> } satisfies Aftel;
    }
    return { soort: "gestart", boven: `GESTART ${klokHM(momenten[0].t)}`, cijfers: formatDuur(nu - momenten[0].t) } satisfies Aftel;
  })();

  // =========================================================
  //  Scheepsjournaal: elk uur een notitie van de verteller
  // =========================================================
  const journaalData = useCallback((t: number): Verteller.VertellerInvoer => ({ raceStart, startPlan, times, rounded: gerond,
    boeien: marks, lijnen: lines, sporen, naam: naamVan, nu: t, wind: windKn != null ? { kn: windKn, richting: windRichting } : null }),
  [raceStart, startPlan, times, gerond, marks, lines, sporen, naamVan, windKn, windRichting]);
  const vijfSec = Math.floor(nu / 5000);
  const journaal = useMemo(() => {
    const t = Date.now(), loopt = !!raceStart && raceStart <= t;
    if (!loopt && !wlModus) return null;
    const d = journaalData(t);
    return { loopt, notities: [...testNotities, ...Verteller.journaal(d)].sort((a, b) => b.t - a.t), volgende: Verteller.volgende(d) };
  }, [vijfSec, journaalData, testNotities, raceStart, wlModus]); // eslint-disable-line react-hooks/exhaustive-deps
  // Bij een nieuwe generatie (race afgerond of gereset) gaan de testnotities weg
  useEffect(() => { setTestNotities([]); }, [baan.gen]);

  // =========================================================
  //  Het piratenspel: een afgelopen zeeslag vanzelf bewaren
  // =========================================================
  const zeeslagOpslaan = useRef<number | null>(null), bewaard = useRef<Set<number>>(new Set());
  const archiveerZeeslag = useCallback(async (s = spel) => {
    if (!admin || !s || !s.start || bewaard.current.has(s.start) || zeeslagOpslaan.current === s.start) return;
    const st = Piraat.stand(s, posTs);
    if (st.wacht || (!st.over && !(st.log || []).length)) return;           // nog niet begonnen, of er gebeurde niets
    const over = st.over || Date.now();
    zeeslagOpslaan.current = s.start;
    try {
      // de sporen van het aftellen tot het einde (met een halve minuut marge)
      const van = s.start - 30000, tot = over + 30000, sp: Record<string, number[][]> = {};
      FLEET.forEach((b) => {
        const pts = (sporen[b] || []).filter((p) => p.ts >= van && p.ts <= tot)
          .map((p) => [+p.lat.toFixed(5), +p.lng.toFixed(5), Math.round((p.ts - van) / 1000)]);
        if (pts.length > 1) sp[b] = dunUit(pts, 1500);
      });
      const namen = Object.fromEntries(FLEET.map((b) => [b, naamVan(b)]));
      const deelnemers = st.deelnemers.length ? st.deelnemers : Object.keys(sp);
      const pTs = Object.fromEntries(deelnemers.map((b) => [b, s.start!]));
      const opslag = zonderLeeg({ start: s.start, eind: s.eind, veld: s.veld, schoten: s.schoten, straf: s.straf, buit: s.buit,
        mijnen: s.mijnen, mijnraak: s.mijnraak });
      const z = zonderLeeg({ start: s.start, ts: Date.now(), over, t0: van, namen, deelnemers, spel: opslag,
        stand: st.volgorde.map((b) => ({ boot: b.boot, levens: b.levens, hits: b.hits, salvos: SPEL.schoten - b.gebruikt, kisten: b.kisten })),
        winnaar: st.winnaar && !st.gelijk ? st.winnaar.boot : null,
        journaal: Piraat.journaal({ ...opslag, eind: s.eind || over }, naamVan, pTs).map((n) => ({ t: n.t, kop: n.kop, tekst: n.tekst })),
        sporen: Object.keys(sp).length ? sp : undefined });
      await m.zeeslag({ token, z });
      bewaard.current.add(s.start);
      setWlStatus("🏴‍☠️ Zeeslag opgeslagen ✓ — de replay en het scheepsjournaal staan bij Uitslagen.");
    } catch (e) {
      setWlStatus("Zeeslag opslaan mislukt: " + foutTekst(e));
    } finally { zeeslagOpslaan.current = null; }
  }, [admin, spel, posTs, sporen, naamVan, token, m.zeeslag]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (admin && spelStand.start && spelStand.over && !spelStand.wacht) archiveerZeeslag();
  }, [admin, spelStand.start, spelStand.over, spelStand.wacht, archiveerZeeslag]);

  // =========================================================
  //  Acties van de wedstrijdleiding
  // =========================================================
  const beginConcept = () => {
    if (concept) return concept;
    const c: Concept = { lines: structuredClone(lines || {}), marks: marks.map((b, i) => ({ ...b, id: boeiId(b, i) })) };
    setConcept(c);
    return c;
  };
  const verschillenTekst = () => {
    if (!concept) return "";
    const r: string[] = [], zelfde = (a: unknown, b: unknown) => JSON.stringify(a || null) === JSON.stringify(b || null);
    if (!zelfde(concept.lines.start, lines.start)) r.push("startlijn aangepast");
    if (!zelfde(concept.lines.finish, lines.finish)) r.push("finishlijn aangepast");
    const oud = new Map(marks.map((b, i) => [boeiId(b, i), b]));
    const nieuw = new Map(concept.marks.map((b, i) => [boeiId(b, i), b]));
    const erbij = [...nieuw.keys()].filter((x) => !oud.has(x)).length;
    const eraf = [...oud.keys()].filter((x) => !nieuw.has(x)).length;
    const verschoven = [...nieuw.keys()].filter((x) => oud.has(x) &&
      (oud.get(x)!.lat !== nieuw.get(x)!.lat || oud.get(x)!.lng !== nieuw.get(x)!.lng)).length;
    const volgorde = [...nieuw.keys()].filter((x) => oud.has(x)).join() !== [...oud.keys()].filter((x) => nieuw.has(x)).join();
    if (erbij) r.push(`${erbij} boei${erbij > 1 ? "en" : ""} toegevoegd`);
    if (eraf) r.push(`${eraf} boei${eraf > 1 ? "en" : ""} weggehaald`);
    if (verschoven) r.push(`${verschoven} boei${verschoven > 1 ? "en" : ""} verplaatst`);
    if (volgorde) r.push("volgorde gewijzigd");
    return r.length ? r.join(", ") : "nog geen wijzigingen";
  };
  const lopend = !!raceStart && raceStart <= nu;
  const acties = {
    startlijn: () => { beginConcept(); zetModus("start", "Tik 2 punten voor de startlijn op de kaart" + lijnUitleg); },
    finishlijn: () => { beginConcept(); zetModus("finish", "Tik 2 punten voor de finishlijn op de kaart" + lijnUitleg); },
    boei: () => {
      if (instelModus === "boei") { zetModus(null, "Klaar met boeien plaatsen."); return; }
      beginConcept(); zetModus("boei", "Tik boeien op de kaart in de te varen volgorde. Versleep een boei om hem te verplaatsen.");
    },
    boeiWeg: () => {
      if (instelModus === "weg") { zetModus(null, "Klaar met boeien weghalen."); return; }
      beginConcept(); zetModus("weg", "Tik op een boei om hem weg te halen.");
    },
    boeienWis: () => { const c = beginConcept(); setConcept({ ...c, marks: [] }); zetModus(null, "Alle boeien weggehaald (concept)."); },
    // Start- en finishlijn weghalen (bijv. voor een zeeslag): ook via het concept, dus pas weg na bevestigen
    lijnenWis: () => { const c = beginConcept(); setConcept({ ...c, lines: {} }); zetModus(null, "Start- en finishlijn weggehaald (concept). Vergeet niet te bevestigen."); },
    bevestig: async () => {
      if (!concept || !admin) return;
      if (!(await bevestig({ titel: "Baan bevestigen?", ok: "✔ Bevestigen",
        tekst: (lopend ? "⚠️ DE RACE LOOPT.\nDe boten krijgen de nieuwe baan direct op hun scherm.\n\n" : "") + "Wijzigingen: " + verschillenTekst() }))) return;
      const ls: Lijnen = {};
      (["start", "finish"] as const).forEach((t) => { if (heeftLijn(concept.lines[t])) ls[t] = concept.lines[t]; });
      if (await doe(() => m.baan({ token, lines: ls, marks: concept.marks.map((b) => ({ id: b.id, lat: b.lat, lng: b.lng })) }),
        "Baan bevestigd ✓ — de boten zien de nieuwe baan.")) { setConcept(null); zetModus(null); }
    },
    annuleer: () => { setConcept(null); zetModus(null, "Wijzigingen geannuleerd."); },
    stelStartVoor: (modus: StartPlan["modus"]) => stelStartVoor(modus),
    voorstelWeg: async () => {
      if (!admin || raceStart || !voorstel || !(await bevestig({ titel: "Het startvoorstel intrekken?", gevaar: true, ok: "Intrekken" }))) return;
      await doe(() => m.voorstelWeg({ token }), "Startvoorstel ingetrokken.");
    },
    rondAf: () => rondRaceAf(),
    reset: async () => {
      if (!admin || !(await bevestig({ titel: "Live race wissen?", gevaar: true, ok: "Wissen",
        tekst: "Live tijden, boei-rondingen, sporen én startsein wissen zónder op te slaan? (de baan blijft staan)" }))) return;
      await doe(() => m.wisLive({ token }), "Live race gewist.");
    },
    vrijgeven: async () => {
      if (!admin || !(await bevestig({ titel: "Alle boten vrijgeven?", ok: "Vrijgeven",
        tekst: "Daarna kan elke telefoon opnieuw een boot kiezen (nodig als een bemanning van telefoon wisselt)." }))) return;
      await doe(() => m.vrijgeven({ token }), "Boten vrijgegeven ✓");
    },
    uitloggen: () => { wl.logout(); },
    veld: () => {
      const aan = !veldModus;
      setVeldModus(aan);
      if (veldMidden.current) { kr.current?.kaart.removeLayer(veldMidden.current.marker); veldMidden.current = null; }
      setWlStatus(aan ? `Tik op de kaart het MIDDEN van het speelveld (standaard een straal van ${SPEL.veldStandaardM} m)…` : "Speelveld tekenen gestopt.");
    },
    veldWeg: async () => {
      if (!admin || !spel?.veld) { setWlStatus("Er staat geen speelveld."); return; }
      if (spelStand.wacht || spelStand.bezig) { setWlStatus("Stop eerst de zeeslag."); return; }
      if (!(await bevestig({ titel: "Het speelveld weghalen?", gevaar: true, ok: "Weghalen",
        tekst: "Dan verdwijnen ook de schootslijnen." }))) return;
      await doe(() => m.veld({ token, veld: null }), "Speelveld weggehaald.");
    },
    spelStart: async () => {
      if (!admin) return;
      const geenVeld = !spel?.veld ? "\n\nLet op: er is nog geen speelveld getekend (dan zijn er ook geen schatkisten)." : "";
      if (!(await bevestig({ titel: "Nieuwe zeeslag starten?", ok: "🏴‍☠️ Start",
        tekst: `Er wordt ${SPEL.aftelMs / 60000} minuten afgeteld (met kanonschoten), daarna krijgen alle schepen weer 3 levens en 10 salvo's.` + geenVeld }))) return;
      // de vorige zeeslag eerst bewaren (loopt hij nog, dan telt hij tot nu)
      if (spel?.start && !spelStand.wacht) await archiveerZeeslag({ ...spel, eind: spel.eind || Date.now() });
      const start = Date.now() + SPEL.aftelMs;
      await doe(() => m.spelStart({ token, start }), `🏴‍☠️ Het aftellen is begonnen: de zeeslag begint om ${formatKlok(start)}.`);
    },
    spelStop: async () => {
      if (!admin || !spel?.start) return;
      if (spelStand.wacht) {
        if (await bevestig({ titel: "Het aftellen naar de zeeslag stoppen?", gevaar: true, ok: "Stoppen" }))
          await doe(() => m.spelStop({ token, wat: "aftellen" }));
      } else if (spelStand.bezig) {
        if (await bevestig({ titel: "De zeeslag nu beëindigen?", tekst: "De huidige stand is de eindstand.", gevaar: true, ok: "Beëindigen" }))
          await doe(() => m.spelStop({ token, wat: "einde" }));
      } else {
        if (!(await bevestig({ titel: "Uitslag van het scherm halen?", ok: "Weghalen",
          tekst: "Het speelveld blijft staan; de zeeslag zelf blijft bewaard bij Uitslagen." }))) return;
        await archiveerZeeslag();
        await doe(() => m.spelStop({ token, wat: "wissen" }));
      }
    },
    gerond: async (boot: string, id: string, label: string) => {
      if (!admin) return;
      const al = gerond[boot]?.[id] != null;
      if (al) {
        if (!(await bevestig({ titel: `Ronding terugdraaien?`, gevaar: true, ok: "Terugdraaien",
          tekst: `Ronding van ${label} voor ${naamVan(boot)} terugdraaien? De telefoon moet de boei dan opnieuw ronden.` }))) return;
        await doe(() => m.gerond({ token, boot, id, ts: null }), `${label} voor ${naamVan(boot)} teruggezet naar niet gerond.`);
      } else {
        if (!(await bevestig({ titel: "Handmatig als gerond markeren?", tekst: `${label} voor ${naamVan(boot)} handmatig als GEROND markeren (tijd: nu)?` }))) return;
        await doe(() => m.gerond({ token, boot, id, ts: Date.now() }), `${label} voor ${naamVan(boot)} handmatig als gerond gemarkeerd.`);
      }
    },
    journaalNu: () => setTestNotities((l) => [...l, Verteller.notitieNu(journaalData(Date.now()))]),
  };

  // De wedstrijdleiding stelt een start voor; de boten geven op de tracker akkoord
  const gekozenStartTijd = () => {
    const [u, mi] = (startTijd || klokHM(voorgesteldeStartTijd(Date.now()))).split(":").map(Number);
    if (isNaN(u) || isNaN(mi)) return null;
    const d = new Date(); d.setHours(u, mi, 0, 0);
    return d.getTime();
  };
  async function stelStartVoor(modus: StartPlan["modus"]) {
    if (!admin) return;
    if (concept) { setWlStatus("Bevestig eerst de baan."); return; }
    if (raceStart) { setWlStatus("De start ligt al vast. Rond eerst de race af of reset de live tijden."); return; }
    const nm = baanLengteNm(lines, marks);
    if (modus !== "gelijk" && nm == null) { setWlStatus(`Voor een ${startNaam(modus).toLowerCase()} is een complete baan nodig.`); return; }
    const t = gekozenStartTijd();
    if (t == null) { setWlStatus("Kies eerst een starttijd."); return; }
    if (t < Date.now() + MIN_VOORSTEL_MS) { setWlStatus("Die starttijd ligt te dicht bij nu of in het verleden: kies een tijd minstens 2 minuten vooruit."); return; }
    if (voorstel && !(await bevestig({ titel: "Startvoorstel vervangen?", tekst: "Er staat al een startvoorstel. Iedereen moet dan opnieuw akkoord geven." }))) return;
    const plan = nm != null ? maakPlan(nm, windKn) : null;
    const lus = modus === "lus" ? maakLusPlan(lines, marks) : null;
    if (modus === "lus" && !lus) { setWlStatus("Voor een lusstart is een complete baan nodig."); return; }
    const vert = modus === "achtervolging" && plan ? plan.vertraging : {};
    const regels = FLEET.map((b) => ({ b, t: t + (vert[b] || 0) })).sort((x, y) => x.t - y.t)
      .map((x) => `  ${naamVan(x.b)}: ${formatKlok(x.t)}` + (lus ? ` · lus +${formatAfstand(lus.extra[x.b])}` : "")).join("\n");
    if (!(await bevestig({ titel: `${startNaam(modus)} voorstellen?`, ok: "📨 Voorstellen", tekst: `${regels}\n\n` +
      (lus ? "Iedereen start tegelijk en vaart een eigen lus van twee extra boeien. Wie het eerst finisht, wint.\n" +
        (lus.past ? "" : "⚠️ De lussen passen niet goed op deze baan (het langste rak is te kort voor de grootste lus).\n") + "\n" : "") +
      "Elke boot moet op de tracker akkoord geven. Pas als iedereen akkoord is, ligt de start vast; daarna verandert hij niet meer." }))) return;
    const sp: StartPlan = { modus, gezet: Date.now() };
    if (plan) {
      sp.nm = +plan.nm.toFixed(3);
      sp.verwacht = plan.verwacht;
      if (plan.windKn != null) sp.windKn = Math.round(plan.windKn * 10) / 10;
    }
    if (modus === "achtervolging") sp.vertraging = vert;
    if (lus && plan) {
      sp.lussen = lus.lussen;
      sp.verwacht = {};
      FLEET.forEach((b) => { sp.verwacht![b] = Math.round(BOTEN[b].gph * lus.lengte[b] * plan.factor) * 1000; });
    }
    if (await doe(() => m.voorstel({ token, t, plan: sp }), `📨 Startvoorstel verstuurd: ${formatKlok(t)}. Wacht op akkoord van alle boten.`))
      setStartTijd("");
  }

  // Race afronden: uitslag, baan, sporen, wind en journaal bewaren, daarna de live race wissen
  async function rondRaceAf() {
    if (!admin) return;
    if (concept) { setWlStatus("Bevestig of annuleer eerst de baanwijziging."); return; }
    const rijen = berekenUitslag(), fin = rijen.filter((r) => r.gefinisht).length;
    if (!(await bevestig({ titel: "Race afronden?", ok: "✅ Afronden",
      tekst: fin ? `Race afronden met ${fin} finisher(s)? De uitslag en de gevaren lijnen (voor de replay) worden opgeslagen en de live tijden gereset.`
        : "Nog geen enkele boot gefinisht. Toch een lege race opslaan?" }))) return;
    setBezig(true);
    setWlStatus("Race opslaan…");
    try {
      // Per punt: [lat, lng, seconden sinds t0] — nodig voor de replay
      let t0 = Infinity;
      FLEET.forEach((b) => (sporen[b] || []).forEach((p) => { if (p.ts < t0) t0 = p.ts; }));
      if (!isFinite(t0)) t0 = Date.now();
      const sporenOpslag: Record<string, number[][]> = {}, afgelegd: Record<string, number> = {};
      FLEET.forEach((b) => {
        const ruw = sporen[b] || [], t = times[b] || {};
        if (t.start != null) afgelegd[b] = Math.round(afgelegdM(ruw, t.start, t.finish));   // uit het volle spoor
        const pts = ruw.map((p) => [+p.lat.toFixed(5), +p.lng.toFixed(5), Math.round((p.ts - t0) / 1000)]);
        if (pts.length > 1) sporenOpslag[b] = dunUit(pts, 900);
      });
      const uitslag: Record<string, { gefinisht: boolean; elapsed: number | null; corrected: number | null; afstand: number | null }> = {};
      rijen.forEach((r) => { uitslag[r.naam] = { gefinisht: r.gefinisht, elapsed: r.gefinisht ? r.elapsed : null,
        corrected: r.gefinisht ? r.corrected : null, afstand: afgelegd[r.naam] ?? null }; });
      const nm = baanLengteNm(lines, marks);
      const res: Record<string, unknown> = { ts: Date.now(), uitslag, namen: Object.fromEntries(FLEET.map((b) => [b, naamVan(b)])),
        modus: startPlan?.modus || "gelijk", baan: { lines, marks } };
      if (nm != null) res.nm = +nm.toFixed(3);
      if (startPlan?.vertraging) res.vertraging = startPlan.vertraging;
      const lussen = lussenVan(startPlan);
      if (lussen) {                                  // lusstart: de lussen en de baanlengte per boot
        res.lussen = lussen;
        res.lengtes = Object.fromEntries(FLEET.map((b) => [b, baanLengteNm(lines, baanVan(b))]).filter(([, n]) => n != null)
          .map(([b, n]) => [b, +(n as number).toFixed(3)]));
      }
      if (Object.keys(sporenOpslag).length) { res.sporen = sporenOpslag; res.t0 = t0; }
      if (raceStart) res.gun = raceStart;
      res.tijden = times;
      if (Object.values(gerond).some((g) => Object.keys(g).length)) res.rondingen = gerond;
      // Wind per uur tijdens de race bewaren (voor de polars); mag mislukken
      try {
        const plek = racePlek(res as never);
        if (plek && raceStart) {
          const van = raceStart - 3600e3, tot = raceEinde(res as never) + 3600e3;
          const uren = await Promise.race([windUren(plek, van, tot), new Promise<[]>((r) => setTimeout(() => r([]), 8000))]);
          const binnen = uren.filter((w) => w.t >= van - 3600e3 && w.t <= tot + 3600e3)
            .map((w) => ({ t: w.t, kn: Math.round(w.kn * 10) / 10, richting: Math.round(w.richting) }));
          if (binnen.length) res.wind = binnen;
        }
      } catch { /* zonder wind */ }
      // Het scheepsjournaal van deze race bewaren (zonder testnotities)
      if (raceStart) {
        const notities = Verteller.journaal({ ...journaalData(Date.now()), afgerond: true }).map((n) => ({ t: n.t, kop: n.kop, tekst: n.tekst }));
        if (notities.length) res.journaal = notities;
      }
      const nr = await m.rondAf({ token, res: zonderLeeg(res) as never });
      setWlStatus(res.sporen ? `Race ${nr} opgeslagen ✓ — bekijk de replay (met video) bij Uitslagen.` : `Race ${nr} opgeslagen ✓ (geen sporen voor een replay).`);
    } catch (e) {
      setWlStatus("Opslaan mislukt: " + foutTekst(e));
    } finally { setBezig(false); }
  }

  // ---- Statusregel van de wedstrijdleiding ----
  const standaardStatus = raceStart ? (raceStart > nu ? "🔒 Start vastgelegd om " : "🔫 Gestart om ") + formatKlok(raceStart)
    : voorstel ? `📨 Startvoorstel voor ${formatKlok(voorstel.t)}: ${akkoordVan(voorstel, akkoord).length} van ${FLEET.length} boten akkoord.`
    : "Nog geen start voorgesteld.";
  const plan = useMemo(() => {
    const nmB = baanLengteNm(huidigeBaan.lines, huidigeBaan.marks);
    return { nm: nmB, plan: nmB != null ? maakPlan(nmB, windKn) : null, lus: nmB != null ? maakLusPlan(huidigeBaan.lines, huidigeBaan.marks) : null };
  }, [huidigeBaan, windKn]);

  // =========================================================
  //  Weergave
  // =========================================================
  return (
    <div className="flex min-h-0 flex-1 max-[820px]:flex-col max-[820px]:overflow-y-auto">
      <div ref={wrapRef} className="relative min-w-0 flex-1 max-[820px]:h-[58vh] max-[820px]:min-h-[320px] max-[820px]:flex-none">
        <KaartVlak className="absolute inset-0" onKaart={opKaart} wind={wind}
          knoppen={[{ id: "overzicht", tekst: "⛶", titel: "Hele baan tonen", klik: overzicht }]}>
          {aftel && <AftelKlok a={aftel} variant="kaart" />}
        </KaartVlak>
      </div>
      <aside className="w-[400px] flex-none overflow-y-auto border-l-[3px] border-messing-donker p-[18px] shadow-[inset_4px_0_12px_#000a] [background:var(--hout-bg)] max-[820px]:w-full max-[820px]:overflow-visible max-[820px]:border-t-[3px] max-[820px]:border-l-0 max-[820px]:pb-[calc(28px+env(safe-area-inset-bottom))]">
        <h1 className="titel-goud m-0 mb-0.5 text-[2.1rem]">☠ Zeilrace</h1>
        {alarmen.map((b) => (
          <Alert key={b} className="mb-2 border-2 border-bloed-licht bg-[linear-gradient(180deg,#7a1d12,#5a130b)] font-bold text-[#ffe9dc]">
            ⚠️ {naamVan(b)}: geen GPS sinds {formatKlok(posities[b]?.ts)}
          </Alert>
        ))}

        <h2 className="sectie-kop">Boten — live</h2>
        <p className="-mt-0.5 mb-2.5 text-[.95rem] leading-snug text-ivoor-zacht">Tik op een boot om hem op de kaart te volgen. ⛶ op de kaart toont weer de hele baan.</p>
        <div className="flex flex-col gap-3">
          {FLEET.map((b) => {
            const ts = posities[b]?.ts, online = !!ts && nu - ts < 30000, t = times[b] || {};
            const s = posities[b] ? { ...posities[b], start: t.start, finish: t.finish, gerond: gerond[b],
              afgelegd: t.start != null ? afgelegdM(sporen[b], t.start, t.finish) : null,
              win: tijdOmTeWinnen(b, times, raceStart, startPlan, nu), voorspel: voorspellingVan(voorspelRijen, b) } : null;
            return <BootKaart key={b} boot={b} naam={naamVan(b)} status={online ? "LIVE" : ts ? geleden(nu - ts) : "geen data"}
              live={online} offline={!online} gekozen={geselecteerd === b} weergave={bootData(s, lines, baanVan(b))} onClick={() => selecteerBoot(b)} />;
          })}
        </div>

        {voorspelRijen.length > 0 && <>
          <h2 className="sectie-kop">🔮 Voorspelde eindstand</h2>
          <Voorspelling rijen={voorspelRijen} naam={naamVan} />
          <p className="mt-2 text-[.95rem] leading-snug text-ivoor-zacht">Tot finish = verwachte tijd tot de finish (met de kloktijd eronder). Totaal = verzeilde tijd
            vanaf de eigen start; Gecorr. = totaal × rating. ≈ en cursief = voorspeld uit het tempo langs de baan (gemiddeld sinds
            de start en het laatste kwartier); 🏁 = binnen.</p>
        </>}

        {!!spelStand.start && <>
          <h2 className="sectie-kop">🏴‍☠️ Het Piratenspel</h2>
          <div className="perkament rounded-md border-2 border-bloed px-3.5 py-3">
            <div className="mb-2 text-muted-foreground italic">{Piraat.statusTekst(spelStand, naamVan)}</div>
            <SpelScore st={spelStand} naam={naamVan} />
            <Collapsible defaultOpen className="mt-3">
              <CollapsibleTrigger className="cursor-pointer font-kap text-[.9rem] font-bold">📦 Wat zit er in de schatkisten?</CollapsibleTrigger>
              <CollapsibleContent>
                <BuitLijst />
                <p className="text-[.95rem] leading-snug text-muted-foreground">Vaar binnen 50 m langs een kist en je krijgt wat erin zit. Zolang je lading bij je hebt,
                  pak je geen nieuwe kist. Elke kist verhuist na 4 minuten naar een nieuwe plek.</p>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </>}

        {wlModus && !admin && !wl.laden && <WlLogin wl={wl} />}
        {wlZicht && (
          <WlPaneel tab={wlTab} setTab={setWlTab} acties={acties} status={wlStatus ?? standaardStatus} bezig={bezig}
            concept={concept ? { tekst: verschillenTekst(), lopend } : null} instelModus={instelModus} veldModus={veldModus}
            raceStart={raceStart} voorstel={voorstel} nmCompleet={baanLengteNm(lines, marks) != null}
            startTijd={startTijd || (raceStart ? "" : klokHM(voorgesteldeStartTijd(nu)))} setStartTijd={setStartTijd}
            correctie={{ gerond, times, naamVan, baanVan }} />
        )}

        {journaal && <Journaal j={journaal} wlModus={wlModus} nu={nu} alleBinnen={FLEET.every((b) => times[b]?.finish != null)}
          onNu={acties.journaalNu} />}

        <Planning raceStart={raceStart} startPlan={startPlan} voorstel={voorstel} akkoord={akkoord} naamVan={naamVan} nu={nu}
          concept={!!concept} marks={huidigeBaan.marks} windKn={windKn} plan={plan} toon={wlZicht} />
      </aside>
    </div>
  );
}
