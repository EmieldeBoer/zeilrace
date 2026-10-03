// ============================================================
//  Replay van een afgeronde race of zeeslag: tijdslider, afspelen,
//  snelheid in kleur, overstaghoeken, video (MP4/WebM) en foto (PNG).
//  Bij een zeeslag: krimpend speelveld, kisten, mijnen, rookwolkjes en
//  vliegende kogels, met de levens per schip.
// ============================================================
import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { BOTEN, metVloot } from "../../../convex/lib/config";
import { SPEL } from "../../../convex/lib/spel";
import { BootStip } from "@/components/BootKaart";
import { useBevestig } from "@/components/Bevestig";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { alsBoeien, koersUitBeweging } from "@/lib/geo";
import { esc, klokHM } from "@/lib/format";
import { kanonschot, speel } from "@/lib/geluid";
import { downloadBlob, maakKaartPNG, maakRaceVideo, videoFormaat } from "@/lib/kaartexport";
import * as Piraat from "@/lib/piraat";
import { schipLabelOffset } from "@/lib/schip";
import { overstagHoeken, positieOp, snelheidKleur, snelheidsSpoor, type Overstag, type SpoorPt } from "@/lib/spoor";
import type { ReplayData, ReplaySpoor } from "@/lib/uitslag";
import { KaartVlak } from "@/kaart/KaartVlak";
import { boeiIcoon, maakSchip, tekenLussen, tekenStartFinish, zetKoers, type Meetlat } from "@/kaart/kaart";
import { animeer, kistLagen, mijnLagen, veldLaag, type KistLaag } from "@/kaart/piraatLagen";

// Koers op een punt in het spoor: richting vanaf een eerder punt dat minstens 8 m terug ligt
function koersInSpoor(pts: SpoorPt[], p: { lat: number; lng: number; i: number }) {
  const hier = { lat: p.lat, lng: p.lng };
  for (let j = p.i; j >= Math.max(0, p.i - 15); j--) {
    const k = koersUitBeweging({ lat: pts[j][0], lng: pts[j][1] }, hier, 8);
    if (k != null) return k;
  }
  return null;
}
const SNELHEID_KLASSEN = 10;
type Stuk = { k: number | null; i0: number; i1: number; stand: "uit" | "vol" | "deel"; laag: L.Polyline };
type Rp = {
  kaart: L.Map; lagen: L.Layer[];
  boten: { s: ReplaySpoor; lijn: L.Polyline; stip: ReturnType<typeof maakSchip> }[];
  overstag: { s: ReplaySpoor; lijst: (Overstag & { marker: L.Marker | null })[] }[];
  kleur: { lo: number; hi: number; boten: { s: ReplaySpoor; stukken: Stuk[] }[] } | null;
  zs: { veld: L.Circle | null; kist: KistLaag | null; kistSleutel: string; mijn: L.LayerGroup | null; mijnSleutel: string; vorigMs: number | null; salvo: Record<string, L.CircleMarker> } | null;
};

export function Replay({ data, sleutel, onSluit }: { data: ReplayData; sleutel: string; onSluit: () => void }) {
  const { melding } = useBevestig();
  const rp = useRef<Rp | null>(null);
  const [kaart, setKaart] = useState<L.Map | null>(null);
  const eind = Math.max(0, ...data.sporen.map((s) => s.pts.length ? s.pts[s.pts.length - 1][2] : 0));
  const [t, setT] = useState(data.gunS != null ? Math.max(0, data.gunS - 30) : 0);
  const [speelt, setSpeelt] = useState(false);
  const [snelheid, setSnelheid] = useState(60);
  const [toonOverstag, setToonOverstag] = useState(false);
  const [kleurAan, setKleurAan] = useState(false);
  const [legenda, setLegenda] = useState<{ boot: string; tekst: string }[]>([]);
  const [slot, setSlot] = useState<string | null>(null);
  const [videoTekst, setVideoTekst] = useState<string | null>(null), [fotoBezig, setFotoBezig] = useState(false);
  const speeltRef = useRef(false), tRef = useRef(t);
  speeltRef.current = speelt; tRef.current = t;

  // Escape sluit
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onSluit(); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onSluit]);

  // ---- Alles op de kaart zetten (één keer per replay) ----
  useEffect(() => {
    if (!kaart) return;
    const lagen: L.Layer[] = [];
    const lines = data.baan?.lines || {}, marks = alsBoeien(data.baan?.marks);
    (["start", "finish"] as const).forEach((x) => { const ln = lines[x]; if (ln && ln.a) tekenStartFinish(kaart, ln, x, lagen, { interactive: false }); });
    marks.forEach((b, i) => lagen.push(L.marker([b.lat, b.lng], { icon: boeiIcoon(i), interactive: false }).addTo(kaart)));
    tekenLussen(kaart, marks, lines, data.lussen, lagen, (b) => data.sporen.find((s) => s.boot === b)?.naam || b);
    let zs: Rp["zs"] = null;
    if (data.zeeslag) {
      const veld = veldLaag(kaart, data.zeeslag.spel?.veld, null);
      if (veld) lagen.push(veld);
      zs = { veld, kist: null, kistSleutel: "", mijn: null, mijnSleutel: "", vorigMs: null, salvo: {} };
    }
    const boten = data.sporen.map((s) => {
      const lijn = L.polyline([], { color: s.kleur, weight: 4, opacity: .9, interactive: false }).addTo(kaart);
      const stip = maakSchip([0, 0], s.boot)
        .bindTooltip(esc(s.naam), { permanent: true, direction: "top", className: "boot-label", offset: schipLabelOffset(s.boot) });
      lagen.push(lijn, stip);
      return { s, lijn, stip };
    });
    // Overstagmomenten per boot (van het startschot tot de eigen finish); labels pas tonen met de schakelaar
    const overstag = data.sporen.map((s) => ({ s, lijst: overstagHoeken(s.pts, data.gunS ?? 0, s.finishS ?? Infinity).map((o) => ({ ...o, marker: null })) }));
    rp.current = { kaart, lagen, boten, overstag, kleur: null, zs };
    const alle = data.sporen.flatMap((s) => s.pts.map((p) => [p[0], p[1]] as [number, number]));
    setTimeout(() => { kaart.invalidateSize(); if (alle.length) kaart.fitBounds(alle, { padding: [30, 30], maxZoom: 16 }); }, 60);
    return () => { lagen.forEach((l) => kaart.removeLayer(l)); rp.current = null; };
  }, [kaart, sleutel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Snelheidsspoor: stukjes spoor per kleurklasse (blauw = langzaam … rood = snel). De schaal
  // past zich aan de race aan: van de langzaamste tot de snelste 10% tijdens de race.
  function bouwSnelheidsSpoor(r: Rp) {
    const van = data.gunS ?? 0;
    const perBoot = data.sporen.map((s) => ({ s, v: snelheidsSpoor(s.pts) }));
    const alle: number[] = [];
    perBoot.forEach(({ s, v }) => v.forEach((x, i) => {
      if (x != null && s.pts[i][2] >= van && (s.finishS == null || s.pts[i][2] <= s.finishS)) alle.push(x);
    }));
    alle.sort((a, b) => a - b);
    const lo = alle.length ? alle[Math.floor(alle.length * .1)] : 0, hi = alle.length ? alle[Math.floor(alle.length * .9)] : 1;
    const klasse = (x: number) => Math.max(0, Math.min(SNELHEID_KLASSEN - 1, Math.floor((x - lo) / Math.max(.1, hi - lo) * SNELHEID_KLASSEN)));
    r.kleur = { lo, hi, boten: perBoot.map(({ s, v }) => {
      const stukken: Stuk[] = [];
      let huidig: Stuk | null = null;
      for (let i = 1; i < s.pts.length; i++) {
        const sv = v[i] != null && v[i - 1] != null ? (v[i]! + v[i - 1]!) / 2 : (v[i] ?? v[i - 1]);
        const k = sv == null ? null : klasse(sv);
        if (!huidig || huidig.k !== k) {
          huidig = { k, i0: i - 1, i1: i, stand: "uit", laag: L.polyline([], { color: k == null ? "#8e7550" : snelheidKleur((k + .5) / SNELHEID_KLASSEN),
            weight: 4, opacity: 1, interactive: false }) };
          stukken.push(huidig); r.lagen.push(huidig.laag);
        } else huidig.i1 = i;
      }
      return { s, stukken };
    }) };
  }

  // ---- Het beeld op tijdstip t ----
  useEffect(() => {
    const r = rp.current; if (!r) return;
    const k = r.kaart;
    r.boten.forEach(({ s, lijn, stip }) => {
      const p = positieOp(s.pts, t);
      if (!p) { lijn.setLatLngs([]); if (k.hasLayer(stip)) k.removeLayer(stip); return; }
      lijn.setLatLngs(s.pts.slice(0, p.i + 1).map((q) => [q[0], q[1]] as [number, number]).concat([[p.lat, p.lng]]));
      // met snelheidskleuren wordt de bootkleur een brede rand onder het gekleurde spoor
      lijn.setStyle(kleurAan ? { weight: 9, opacity: .8 } : { weight: 4, opacity: .9 });
      stip.setLatLng([p.lat, p.lng]);
      if (!k.hasLayer(stip)) stip.addTo(k);
      zetKoers(stip, koersInSpoor(s.pts, p));
    });
    if (kleurAan && !r.kleur) bouwSnelheidsSpoor(r);
    if (r.kleur) r.kleur.boten.forEach(({ s, stukken }) => {
      const p = kleurAan ? positieOp(s.pts, t) : null;
      stukken.forEach((st) => {
        const stand = !p || s.pts[st.i0][2] > t ? "uit" : st.i1 <= p.i ? "vol" : "deel";
        if (stand === "uit") { if (st.stand !== "uit") { k.removeLayer(st.laag); st.stand = "uit"; } return; }
        if (stand === "vol" && st.stand === "vol") return;          // al helemaal getekend
        const ll = s.pts.slice(st.i0, Math.min(st.i1, p!.i) + 1).map((q) => [q[0], q[1]] as [number, number]);
        if (stand === "deel") ll.push([p!.lat, p!.lng]);
        st.laag.setLatLngs(ll);
        if (st.stand === "uit") st.laag.addTo(k);
        st.stand = stand;
      });
    });
    // Overstaghoeken: een label bij elk overstagmoment dat op tijdstip t al geweest is
    r.overstag.forEach(({ s, lijst }) => lijst.forEach((o) => {
      const zichtbaar = toonOverstag && o.s <= t;
      if (zichtbaar && !o.marker) {
        o.marker = L.marker([o.lat, o.lng], { interactive: false, keyboard: false,
          icon: L.divIcon({ className: "overstag-label", html: `<span style="border-color:${s.kleur}">${o.hoek}°</span>`, iconSize: [0, 0] }) });
        r.lagen.push(o.marker);
      }
      if (o.marker) {
        if (zichtbaar && !k.hasLayer(o.marker)) o.marker.addTo(k);
        if (!zichtbaar && k.hasLayer(o.marker)) k.removeLayer(o.marker);
      }
    }));
    if (r.zs) { zetZeeslagTijd(r); return; }
    const overstagTekst = (b: string) => {
      const o = toonOverstag && r.overstag.find((x) => x.s.boot === b);
      if (!o || !o.lijst.length) return "";
      const gem = Math.round(o.lijst.reduce((a, x) => a + x.hoek, 0) / o.lijst.length);
      return ` · overstag gem. ${gem}° (${o.lijst.length}×)`;
    };
    setLegenda(data.sporen.map((s) => ({ boot: s.boot, tekst: `${s.finishS != null && t >= s.finishS ? "🏁 " : ""}${s.legenda}${overstagTekst(s.boot)}` })));
    setSlot(null);
  }, [t, kaart, toonOverstag, kleurAan, sleutel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Zeeslag op tijdstip t: de stand van dat moment (levens, raak, salvo's), de kisten die toen
  // in het water lagen, de mijnen, en een rookwolkje op elke plek waar een salvo viel.
  // Tijdens het afspelen vliegen de kogels zoals live.
  function zetZeeslagTijd(r: Rp) {
    const z = data.zeeslag!, spel = z.spel || {}, nuMs = data.t0! + t * 1000, zs = r.zs!, k = r.kaart, naam = data.naam!;
    const vloot = [...new Set([...z.deelnemers, ...Object.keys(z.sporen || {})])];
    const st = metVloot(vloot, () => Piraat.stand({ ...spel, eind: Math.min(spel.eind || Infinity, nuMs, z.over || Infinity) }, data.posTs || {}, Infinity));
    if (zs.veld && spel.veld) zs.veld.setRadius(Piraat.straal(spel.veld, z.start, Math.min(nuMs, z.over || Infinity)) ?? spel.veld.r);
    const posOp = (b: string, ms: number) => {
      const s = data.sporen.find((x) => x.boot === b), p = s && positieOp(s.pts, (ms - data.t0!) / 1000);
      return p ? { lat: p.lat, lng: p.lng } : null;
    };
    // kisten: alleen die op dit moment in het water lagen en nog niet gepakt waren
    const buit: Record<string, { boot: string; ts: number }> = {};
    Object.entries(spel.buit || {}).forEach(([nr, x]) => { if (x && x.ts <= nuMs) buit[nr] = x; });
    const kisten = nuMs >= z.start ? Piraat.kisten({ ...spel, buit, eind: z.over || spel.eind }, nuMs) : [];
    const kSleutel = kisten.map((x) => x.nr).join(",");
    if (kSleutel !== zs.kistSleutel) {
      zs.kist = kistLagen(k, kisten, zs.kist); zs.kistSleutel = kSleutel;
      if (!r.lagen.includes(zs.kist.groep)) r.lagen.push(zs.kist.groep);
    }
    const mijnen = st.mijnen.filter((x) => x.actief), mSleutel = mijnen.map((x) => x.id).join(",");
    if (mSleutel !== zs.mijnSleutel) {
      zs.mijn = mijnLagen(k, mijnen, zs.mijn); zs.mijnSleutel = mSleutel;
      if (zs.mijn) r.lagen.push(zs.mijn);
    }
    // salvo's: een rookwolkje (met wie, en wie er geraakt werd) vanaf het moment van schieten
    st.geldig.forEach((g) => {
      if (zs.salvo[g.id]) return;
      const raak = g.raak.length ? ` en raakt ${g.raak.map(naam).join(" en ")}` : g.geblokt.length ? " op een schild" : " (mis)";
      zs.salvo[g.id] = L.circleMarker([g.schot.lat, g.schot.lng], { radius: g.raak.length ? 7 : 5, color: BOTEN[g.boot].kleur, weight: 3,
        fillColor: g.raak.length ? "#8b1e12" : "#e6dcc6", fillOpacity: .9 }).bindTooltip(`${klokHM(g.schot.ts)} · ${esc(naam(g.boot))} vuurt${esc(raak)}`);
      r.lagen.push(zs.salvo[g.id]);
    });
    Object.entries(zs.salvo).forEach(([id, mk]) => {
      const zichtbaar = st.geldig.some((g) => g.id === id);
      if (zichtbaar && !k.hasLayer(mk)) mk.addTo(k);
      if (!zichtbaar && k.hasLayer(mk)) k.removeLayer(mk);
    });
    // afspelen: de kogels laten vliegen van salvo's die sinds de vorige stap vielen
    if (speeltRef.current && zs.vorigMs != null && nuMs > zs.vorigMs)
      st.geldig.filter((g) => g.schot.ts > zs.vorigMs! && g.schot.ts <= nuMs)
        .forEach((g) => { animeer(k, g.schot, g.raak, (b) => posOp(b, g.schot.ts), g.geblokt); speel(() => kanonschot()); });
    zs.vorigMs = nuMs;
    setLegenda(data.sporen.map((s) => {
      const b = st.boten[s.boot];
      return { boot: s.boot, tekst: `${s.naam} — ${b.levens ? Piraat.levensTekst(b) : "☠️ gezonken"} · ${b.hits}× raak · ${SPEL.schoten - b.gebruikt} salvo's` };
    }));
    setSlot(z.over && nuMs >= z.over ? Piraat.statusTekst(st, naam) : null);
  }

  // ---- Afspelen ----
  useEffect(() => {
    if (!speelt) return;
    let vorig = performance.now(), id = 0;
    const stap = (nu: number) => {
      const nieuw = Math.min(eind, tRef.current + (nu - vorig) / 1000 * snelheid);
      vorig = nu; tRef.current = nieuw; setT(nieuw);
      if (nieuw >= eind) { setSpeelt(false); return; }
      id = requestAnimationFrame(stap);
    };
    id = requestAnimationFrame(stap);
    return () => cancelAnimationFrame(id);
  }, [speelt, snelheid, eind]);
  const speelOfPauze = () => {
    if (speelt) { setSpeelt(false); return; }
    if (t >= eind) setT(0);
    setSpeelt(true);
  };

  async function foto() {
    setFotoBezig(true);
    try {
      const blob = await maakKaartPNG(data, t);
      if (blob) downloadBlob(blob, `zeilrace-${sleutel}.png`);
    } catch (e) { await melding({ titel: "Foto maken mislukt", tekst: (e as Error).message }); }
    finally { setFotoBezig(false); }
  }
  async function video() {
    if (!videoFormaat()) { await melding({ titel: "Geen video mogelijk", tekst: "Deze browser kan geen video opnemen. Probeer Chrome, Edge of Safari." }); return; }
    setSpeelt(false); setVideoTekst("🎬 0%");
    try {
      const v = await maakRaceVideo(data, (f) => setVideoTekst(`🎬 ${Math.round(f * 100)}%`));
      if (v) downloadBlob(v.blob, `zeilrace-${sleutel}.${v.ext}`);
    } catch (e) { await melding({ titel: "Video maken mislukt", tekst: (e as Error).message }); }
    finally { setVideoTekst(null); }
  }

  const kleurSchaal = kleurAan && rp.current?.kleur;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="replayTitel"
      className="fixed inset-0 z-[2500] flex flex-col bg-paneel pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="balk flex items-center gap-2.5 px-3.5 py-2.5">
        <div id="replayTitel" className="titel min-w-0 flex-1 truncate text-[1.5rem] text-kop">{data.titel}</div>
        <Button size="sm" onClick={() => { setSpeelt(false); onSluit(); }} aria-label="Sluiten">✕ Sluiten</Button>
      </div>
      <KaartVlak className="min-h-[200px] flex-1" onKaart={(k: L.Map, _m: Meetlat) => { void _m; setKaart(k); }} />
      <div className="border-t-2 border-kader bg-paneel px-3.5 pt-2.5 pb-3.5">
        <div className="text-center font-kop text-[1.15rem] font-bold text-kop">{data.klok(t)}</div>
        <Slider className="my-3" min={0} max={Math.max(1, Math.ceil(eind))} step={1} value={[t]} aria-label="Tijd in de race"
          onValueChange={(v) => { setSpeelt(false); setT(Array.isArray(v) ? v[0] : (v as number)); }} />
        <div className="flex flex-wrap gap-2">
          <Button size="xl" className="flex-[1_1_110px]" onClick={speelOfPauze}>{speelt ? "⏸ Pauze" : "▶ Afspelen"}</Button>
          <Select value={String(snelheid)} items={Object.fromEntries([10, 30, 60, 120, 300].map((x) => [String(x), `${x}×`]))} onValueChange={(v) => { if (v) setSnelheid(Number(v)); }}>
            <SelectTrigger aria-label="Afspeelsnelheid" className="h-[54px] w-[96px] border-rand bg-card font-kop font-bold text-card-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 30, 60, 120, 300].map((x) => <SelectItem key={x} value={String(x)}>{x}×</SelectItem>)}
            </SelectContent>
          </Select>
          {!data.zeeslag && <>
            <Button size="xl" className="flex-[1_1_110px]" disabled={!!videoTekst} onClick={video}>{videoTekst ?? "🎬 Video"}</Button>
            <Button size="xl" variant="secondary" className="flex-[1_1_110px]" disabled={fotoBezig} onClick={foto}>{fotoBezig ? "⏳ Foto…" : "🖼 Foto"}</Button>
          </>}
        </div>
        <label className="mt-2.5 flex min-h-9 cursor-pointer items-center gap-2 font-kop text-[.85rem] font-bold tracking-[.03em] text-foreground">
          <Switch checked={toonOverstag} onCheckedChange={setToonOverstag} /> ⤢ Overstaghoeken tonen</label>
        <label className="mt-1 flex min-h-9 cursor-pointer items-center gap-2 font-kop text-[.85rem] font-bold tracking-[.03em] text-foreground">
          <Switch checked={kleurAan} onCheckedChange={setKleurAan} /> 🌈 Snelheid in kleur</label>
        {kleurSchaal && (
          <div className="mt-0.5 mb-1 ml-7 flex items-center gap-2 font-kop text-[.78rem] font-bold text-muted-foreground">
            <span>{kleurSchaal.lo.toFixed(1)} kn</span>
            <span className="h-2.5 flex-[0_1_180px] rounded-[5px] border border-kader bg-[linear-gradient(90deg,#2c6fbb,#3fa7c9,#e8c33a,#e07b2c,#c0392b)]" />
            <span>{kleurSchaal.hi.toFixed(1)} kn</span>
          </div>
        )}
        <div className="mt-2.5 text-base leading-relaxed text-foreground">
          {legenda.map((l) => <div key={l.boot}><BootStip boot={l.boot} className="mr-1.5 border-foreground" />{l.tekst}</div>)}
          {slot && <div><b>{slot}</b></div>}
        </div>
      </div>
    </div>
  );
}
