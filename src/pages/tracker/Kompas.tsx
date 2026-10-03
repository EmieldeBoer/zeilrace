// ============================================================
//  Het kompas dat niet naar het noorden wijst, maar naar datgene wat je
//  het liefste wilt: je volgende doel (startlijn, boei, finish).
//  Met een kompassensor draait de windroos mee met de echte richtingen.
//  Bewust zonder uitleg in beeld: de zeiler moet zelf uitvinden waar het naar wijst.
// ============================================================
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { afstandMeter, peiling, type LatLng } from "@/lib/geo";

type Bron = { hier: () => LatLng | null; doel: (p: LatLng) => LatLng | null; gpsKoers: () => number | null };
type Diag = { abs: number; rel: number; laatste: string; toestemming: string; sensorApi: string; bron?: string };
type SensorKlasse = new (o: { frequency: number; referenceFrame: string }) => EventTarget & { quaternion: number[]; start: () => void };
const verschil = (a: number, b: number) => ((b - a + 540) % 360) - 180;       // kortste hoekverschil
const vraagtToestemming = () => !!(window.DeviceOrientationEvent &&
  typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission === "function");

export function Kompas({ open, setOpen, bron }: { open: boolean; setOpen: (o: boolean) => void; bron: Bron }) {
  const naald = useRef<SVGGElement>(null), roos = useRef<SVGGElement>(null);
  const [activeerKnop, setActiveerKnop] = useState(false);
  const [test, setTest] = useState("");
  const bronRef = useRef(bron);
  bronRef.current = bron;
  // Toestand die het hele leven van de pagina blijft (sensor, laatste hoeken)
  const s = useRef({ hoek: 0, roosHoek: 0, zoekFase: Math.random() * 6, geopend: 0, gevraagd: false, anker: null as LatLng | null,
    vorigeGps: null as LatLng | null, hier: null as LatLng | null, sensorKoers: null as number | null, sensorTijd: 0,
    luistert: false, sensorApi: null as (EventTarget & { quaternion: number[]; start: () => void }) | null,
    diag: { abs: 0, rel: 0, laatste: "—", toestemming: "—", sensorApi: "—" } as Diag });
  const testModus = new URLSearchParams(location.search).has("kompastest");

  // ---- Richting van de telefoon ----
  // 1. de kompassensor via de oriëntatie-berichten (iPhone: webkitCompassHeading; Android: absolute alpha)
  // 2. de kompassensor via de Sensor-API van Chrome (AbsoluteOrientationSensor)
  // 3. valt dat allemaal weg: de GPS-koers van de boot (werkt als je vaart)
  const zetSensorKoers = (h: number, b: string) => {
    s.current.sensorKoers = (h + 360) % 360; s.current.sensorTijd = Date.now(); s.current.diag.bron = b;
    setActiveerKnop(false);                 // sensor werkt: knop niet meer nodig
  };
  const richting = () => {
    const x = s.current;
    if (x.sensorKoers != null && Date.now() - x.sensorTijd < 3000) return x.sensorKoers;
    return bronRef.current.gpsKoers();
  };
  function startSensorApi() {
    const x = s.current, Klasse = (window as unknown as { AbsoluteOrientationSensor?: SensorKlasse }).AbsoluteOrientationSensor;
    if (x.sensorApi || !Klasse) { if (!x.sensorApi) x.diag.sensorApi = "niet aanwezig"; return; }
    try {
      const api = new Klasse({ frequency: 20, referenceFrame: "screen" });
      x.sensorApi = api;
      api.addEventListener("reading", () => {
        const [qx, qy, qz, qw] = api.quaternion;
        const gier = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz)) * 180 / Math.PI;   // draaiing om de verticaal
        x.diag.sensorApi = "meet " + Math.round((360 - gier) % 360) + "°";
        if (x.sensorKoers == null || x.diag.bron !== "oriëntatie" || Date.now() - x.sensorTijd > 1000) zetSensorKoers(360 - gier, "sensor-api");
      });
      api.addEventListener("error", (e) => { x.diag.sensorApi = "fout: " + ((e as unknown as { error?: Error }).error?.name); });
      api.start(); x.diag.sensorApi = "gestart";
    } catch (e) { x.diag.sensorApi = "fout: " + (e as Error).name; x.sensorApi = null; }
  }
  function opOrientatie(e: DeviceOrientationEvent) {
    const x = s.current, w = e as DeviceOrientationEvent & { webkitCompassHeading?: number };
    if (e.type === "deviceorientationabsolute") x.diag.abs++; else x.diag.rel++;
    x.diag.laatste = `${e.type === "deviceorientationabsolute" ? "abs" : "rel"} α=${e.alpha == null ? "—" : Math.round(e.alpha)} ` +
      `absolute=${e.absolute}${w.webkitCompassHeading != null ? " wch=" + Math.round(w.webkitCompassHeading) : ""}`;
    let h: number | null = null;
    if (typeof w.webkitCompassHeading === "number" && !isNaN(w.webkitCompassHeading)) h = w.webkitCompassHeading;   // iPhone
    else if (e.absolute && typeof e.alpha === "number" && !isNaN(e.alpha)) h = 360 - e.alpha;                       // Android
    if (h == null) return;
    zetSensorKoers(h + ((screen.orientation && screen.orientation.angle) || 0), "oriëntatie");
  }
  // Meteen luisteren naar beide soorten berichten: browsers die geen toestemming
  // vragen leveren dan direct; de rest na de tik op 'Activeer het kompas'.
  function luisterSensor() {
    if (!s.current.luistert) {
      s.current.luistert = true;
      addEventListener("deviceorientationabsolute" as "deviceorientation", opOrientatie);
      addEventListener("deviceorientation", opOrientatie);
    }
    startSensorApi();
  }
  async function activeer() {
    setActiveerKnop(false);                 // na één tik weg (ook bij weigeren)
    s.current.gevraagd = true;
    luisterSensor();
    // Chrome (Android) wil 'true' voor het kompas zelf (magnetometer); Safari negeert het argument
    const vraag = (DeviceOrientationEvent as unknown as { requestPermission: (x?: boolean) => Promise<string> }).requestPermission;
    try { s.current.diag.toestemming = await vraag(true); }
    catch {
      try { s.current.diag.toestemming = await vraag(); }
      catch (e2) { s.current.diag.toestemming = "fout: " + (e2 as Error).name; }
    }
    s.current.sensorApi = null; startSensorApi();                // na toestemming de Sensor-API opnieuw proberen
  }

  // ---- Openen: sensor aan, positie ophalen, animatie starten ----
  useEffect(() => {
    if (!open) return;
    const x = s.current;
    luisterSensor();
    x.geopend = performance.now();
    setActiveerKnop(false);
    x.hier = bronRef.current.hier() ?? x.hier;
    if ("geolocation" in navigator)
      navigator.geolocation.getCurrentPosition((p) => { x.hier = { lat: p.coords.latitude, lng: p.coords.longitude }; },
        () => {}, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    let id = 0;
    const frame = () => {
      const eigen = bronRef.current.hier();
      if (eigen) x.hier = eigen;
      // De vorige GPS-positie: het punt waar je minstens 10 m geleden was
      if (x.hier) {
        if (!x.anker) x.anker = x.hier;
        else if (afstandMeter(x.anker, x.hier) >= 10) { x.vorigeGps = x.anker; x.anker = x.hier; }
      }
      const d = x.hier ? bronRef.current.doel(x.hier) : null, t = performance.now() / 1000, koers = richting();
      let naar: number;
      if (d && x.hier) {
        naar = peiling(x.hier, d) - (koers ?? 0);
        // een eigenwijs kompas: het trilt en twijfelt een beetje
        naar += Math.sin(t * 2.3) * 3 + Math.sin(t * 5.1) * 1.5;
      } else {
        x.zoekFase += 0.016;
        naar = x.hoek + 6 + Math.sin(x.zoekFase * 1.7) * 14;             // draait zoekend rond
      }
      x.hoek += verschil(x.hoek, naar) * 0.08;
      // Het 'noorden' van de windroos wijst naar je vorige GPS-positie (zonder die: het echte noorden)
      const noord = x.vorigeGps && x.hier ? peiling(x.hier, x.vorigeGps) : 0;
      x.roosHoek += verschil(x.roosHoek, noord - (koers ?? 0)) * 0.15;
      // Nog geen kompasdata na 2 s, terwijl de browser om toestemming vraagt? Dan de knop tonen
      if (x.sensorKoers == null && !x.gevraagd && vraagtToestemming() && performance.now() - x.geopend > 2000) setActiveerKnop(true);
      naald.current?.setAttribute("transform", `rotate(${x.hoek.toFixed(2)})`);
      roos.current?.setAttribute("transform", `rotate(${x.roosHoek.toFixed(2)})`);
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    // Testmodus (?kompastest): laat zien wat de telefoon doorgeeft
    const tt = testModus ? setInterval(() => {
      const r = richting(), dg = x.diag;
      setTest(`veilig: ${isSecureContext} · vraagt toestemming: ${vraagtToestemming()} · toestemming: ${dg.toestemming}\n` +
        `berichten abs: ${dg.abs} · rel: ${dg.rel}\nlaatste: ${dg.laatste}\n` +
        `sensor-api: ${dg.sensorApi}\nbron: ${x.sensorKoers != null && Date.now() - x.sensorTijd < 3000 ? dg.bron : (r != null ? "gps" : "geen")}` +
        ` · richting: ${r == null ? "—" : Math.round(r) + "°"}\n${navigator.userAgent.match(/Chrome\/[\d.]+/) || ""}`);
    }, 400) : null;
    return () => { cancelAnimationFrame(id); if (tt) clearInterval(tt); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const sluit = () => { setOpen(false); try { localStorage.setItem("zeilrace-kompas", "1"); } catch { /* */ } };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) sluit(); }}>
      <DialogContent showCloseButton={false} className="max-h-[96vh] w-[min(94vw,420px)] max-w-none overflow-y-auto px-[18px] pt-[18px] pb-4 text-center sm:max-w-none">
        <DialogTitle className="mb-1.5 font-titel text-[2.3rem] font-normal text-signaal">Het Kompas</DialogTitle>
        <svg className="mx-auto block h-auto w-[min(72vw,300px)] drop-shadow-[0_6px_10px_rgba(0,0,0,.5)]" viewBox="-110 -110 220 220" aria-hidden="true">
          <defs>
            <radialGradient id="kpPerk" cx="40%" cy="35%" r="75%">
              <stop offset="0" stopColor="#f6e9c8" /><stop offset=".7" stopColor="#e2cb98" /><stop offset="1" stopColor="#b8935a" />
            </radialGradient>
            <linearGradient id="kpMessing" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#f7e2a6" /><stop offset=".5" stopColor="#c9a24a" /><stop offset="1" stopColor="#6e4f18" />
            </linearGradient>
          </defs>
          <circle r="106" fill="url(#kpMessing)" />
          <circle r="97" fill="#2a1b0d" />
          <circle r="94" fill="url(#kpPerk)" />
          <g ref={roos}>
            <g fill="none" stroke="#6b5130" strokeWidth=".8"><circle r="86" /><circle r="70" /></g>
            {/* streepjes op de windroos (elke 10°, langer per 30°) */}
            <g stroke="#2b1b0d" strokeWidth="1">
              {Array.from({ length: 36 }, (_, i) => <line key={i} y1={-86} y2={-86 + (i % 3 === 0 ? 8 : 4)} transform={`rotate(${i * 10})`} />)}
            </g>
            <g fill="#2b1b0d" opacity=".9">
              <path d="M0-68 L7-7 L0 0 Z" /><path d="M0-68 L-7-7 L0 0 Z" fill="#6b5130" />
              <path d="M68 0 L7 7 L0 0 Z" /><path d="M68 0 L7-7 L0 0 Z" fill="#6b5130" />
              <path d="M0 68 L-7 7 L0 0 Z" /><path d="M0 68 L7 7 L0 0 Z" fill="#6b5130" />
              <path d="M-68 0 L-7-7 L0 0 Z" /><path d="M-68 0 L-7 7 L0 0 Z" fill="#6b5130" />
            </g>
            <g fill="#6b5130" opacity=".75" transform="rotate(45)">
              <path d="M0-48 L5-5 L0 0 Z" /><path d="M48 0 L5 5 L0 0 Z" /><path d="M0 48 L-5 5 L0 0 Z" /><path d="M-48 0 L-5-5 L0 0 Z" />
            </g>
            <g fontFamily="Cinzel, Georgia, serif" fontWeight="700" fontSize="15" textAnchor="middle" fill="#2b1b0d">
              <text y="-74" fill="#8b1e12">N</text><text x="79" y="5">O</text><text y="85">Z</text><text x="-79" y="5">W</text>
            </g>
          </g>
          <g ref={naald}>
            <path d="M0-80 L9 0 L0 12 L-9 0 Z" fill="#8b1e12" stroke="#2b1b0d" strokeWidth="1.2" />
            <path d="M0 58 L7 0 L-7 0 Z" fill="#2b1b0d" />
            <circle cy="-80" r="3.5" fill="#f0c75e" stroke="#2b1b0d" />
          </g>
          <circle r="8" fill="url(#kpMessing)" stroke="#2b1b0d" strokeWidth="1.2" />
        </svg>
        {activeerKnop && <Button size="xl" variant="secondary" className="mt-[18px]" onClick={activeer}>🧭 Activeer het kompas</Button>}
        {testModus && <pre className="mt-2 rounded bg-white/50 p-1.5 text-left font-mono text-[12px] leading-[1.35] whitespace-pre-wrap">{test}</pre>}
        <Button size="xl" className="mt-[18px]" onClick={sluit}>⚓ Aan boord!</Button>
      </DialogContent>
    </Dialog>
  );
}
