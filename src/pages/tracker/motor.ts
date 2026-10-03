// ============================================================
//  Zeilrace: de motor van de tracker (telefoon op de boot)
//  Stuurt GPS door, detecteert start/boeien/finish, het GPS-alarm,
//  meldingen en het kanon van het piratenspel. Een gewone klasse met
//  eigen toestand (zoals tracker.js), zodat GPS-callbacks altijd de
//  actuele gegevens zien; de pagina tekent opnieuw na elke wijziging.
// ============================================================
import type { ConvexReactClient } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { FLEET, RONDINGS_LIJN_M, RONDINGS_MARGE_MAX_M } from "../../../convex/lib/config";
import { BUIT, SPEL } from "../../../convex/lib/spel";
import type { Schot } from "../../../convex/lib/validators";
import type { BaanData, BootInfo, PositieInfo } from "@/hooks/useRace";
import { baanVanBoot, doelVanBoot, lussenVan, vertragingVan, type Gerond } from "@/lib/baan";
import { Feest } from "@/lib/feest";
import { foutTekst } from "@/lib/fouten";
import { formatDuur, formatKlok, groteLetter } from "@/lib/format";
import { GELUID, initAudio, kanonschot, scheepsbel, speel } from "@/lib/geluid";
import { afstandMeter, boeiPrevNext, lijnstukkenKruisen, peiling, rondingsLijn, heeftLijn, type LatLng } from "@/lib/geo";
import * as Piraat from "@/lib/piraat";
import type { SpelData } from "../../../convex/lib/validators";

export type Melding = { tekst: string; soort?: "goed" | "fout" };
export type MotorData = {
  baan: BaanData; boten: Record<string, BootInfo>; posities: Record<string, PositieInfo>;
  spel: SpelData | null; naamVan: (b: string) => string;
};
type Fix = LatLng & { ts: number; acc?: number };

const SCHRIJF_INTERVAL = 3000;     // max 1x per 3 sec naar de database
const GPS_OPTIES: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 };
const kleinLabel = (l: string) => l.charAt(0).toLowerCase() + l.slice(1);     // 'Lusboei A' → 'lusboei A'
const vrijNummer = (lijst: Record<string, unknown> | undefined, max: number) => {
  const l = lijst || {};
  for (let i = 0; i < max; i++) if (l[i] == null) return i;
  return null;
};

export class TrackerMotor {
  private convex: ConvexReactClient;
  private opnieuw: () => void;
  private readonly groep: Id<"groepen">;
  readonly token: string;
  data: MotorData = { baan: { lines: {}, marks: [], raceStart: null, startPlan: null, voorstel: null, gen: 0, quotes: [] }, boten: {}, posities: {}, spel: null, naamVan: (b) => b };
  spelStand: Piraat.SpelStand = Piraat.stand(null, {});

  boot: string = FLEET[0];
  actief = false;
  private watchId: number | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private laatsteSchrijf = 0;
  laatsteFix = 0;
  private laatsteHerstart = 0;
  private laatsteGpsFout: number | null = null;
  melding: Melding = { tekst: "" };
  gpsAlarm: { titel: string; uitleg: string } | null = null;
  private alarmTimer: ReturnType<typeof setInterval> | null = null;
  private alarmStil = false;
  private verborgenSinds: number | null = null;
  private achtergrondGemeld = false;
  private swReg: ServiceWorkerRegistration | null = null;

  // Eigen voortgang (lokaal al actueler dan de database)
  mijnTijden: { start: number | null; finish: number | null } = { start: null, finish: null };
  mijnGerond: Gerond = {};
  private serverGerond: Gerond | null = null;
  private wachtend = new Set<string>();         // eigen rondingen die nog onderweg zijn naar de server
  private vorigeRuwe: Fix | null = null;
  mijnPositie: LatLng | null = null;
  mijnSnelheid: number | null = null;
  mijnHeading: number | null = null;
  mijnKoers: number | null = null;               // koers (graden) voor het kanon
  private koersVan: LatLng | null = null;
  nauwkeurigheid: number | null = null;

  // Het piratenspel
  private herladenTot = 0;
  buitenSinds: number | null = null;
  private kistBezig = false;
  private mijnGemeld = new Set<string>();         // mijnen waar we al overheen voeren (één melding per mijn)
  private kistMislukt = new Set<string>();        // kisten waarvan het pakken geweigerd werd: niet elke seconde opnieuw
  private vorigeMij: { start?: number; levens: number; straf: number; mijnRaak: number; geblokt: number } | null = null;
  private vorigBezig: { start?: number; bezig: boolean } | null = null;
  private vorigeKrimpCheck: number | null = null;

  constructor(convex: ConvexReactClient, groep: Id<"groepen">, token: string, opnieuw: () => void) {
    this.convex = convex;
    this.groep = groep;
    this.token = token;
    this.opnieuw = opnieuw;
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").then((r) => { this.swReg = r; }).catch(() => {});
  }

  // ---- Hulpjes ----
  meld(tekst: string, soort?: Melding["soort"]) { this.melding = { tekst, soort }; this.opnieuw(); }
  private schrijf(p: Promise<unknown>) { return p.catch((e) => this.meld(foutTekst(e), "fout")); }
  get naam() { return this.data.naamVan(this.boot); }
  mijnBaan() { return baanVanBoot(this.data.baan.marks, lussenVan(this.data.baan.startPlan), this.boot); }
  // Jouw eigen starttijd (bij een achtervolgingsstart later dan het eerste sein)
  mijnStart() {
    const { raceStart, startPlan } = this.data.baan;
    return raceStart != null ? raceStart + vertragingVan(startPlan, this.boot) : null;
  }
  volgendDoel(pos: LatLng) {
    return doelVanBoot(pos, this.mijnTijden.start, this.mijnTijden.finish, this.mijnGerond, this.data.baan.lines, this.mijnBaan());
  }
  volgendDoelLabel() {
    if (this.mijnTijden.finish != null) return null;
    if (this.mijnTijden.start == null) return "de startlijn";
    const v = this.mijnBaan().find((b) => this.mijnGerond[b.id] == null);
    return v ? kleinLabel(v.label) : "de finish";
  }
  eigenPos(): LatLng | null {
    if (this.mijnPositie) return this.mijnPositie;
    const s = this.data.posities[this.boot];
    return s ? { lat: s.lat, lng: s.lng } : null;
  }
  posTijden() {
    const t: Record<string, number> = {};
    FLEET.forEach((b) => { if (this.data.posities[b]) t[b] = this.data.posities[b].ts; });
    if (this.actief && this.laatsteFix) t[this.boot] = Math.max(t[this.boot] || 0, this.laatsteFix);
    return t;
  }

  // ---- Gegevens van de server: eigen tijden en rondingen bijhouden ----
  // De database is leidend: zo komen handmatige correcties van de wedstrijdleiding
  // (boei gerond / teruggedraaid) en een reset van de race direct op de boot aan.
  zetData(d: MotorData) {
    this.data = d;
    if (!this.actief) return;
    const s = d.boten[this.boot];
    if (!s) { this.stop(false); this.meld("Deze boot is uit de groep gehaald. Kies een andere boot.", "fout"); return; }
    // Een ander toestel heeft de boot overgenomen (bijv. een andere telefoon aan boord)
    if (!s.vanMij) {
      this.stop(false);
      this.meld(`Je boot is overgenomen${s.claimNaam ? " door " + s.claimNaam : ""} op een ander toestel. Deze telefoon stuurt geen positie meer.`, "fout");
      return;
    }
    // Auto-reset: wist de wedstrijdleiding de race (tijden weg), dan wist de tracker zijn eigen voortgang
    if (s.start == null && s.finish == null && (this.mijnTijden.start != null || this.mijnTijden.finish != null) && !this.wachtend.has("start")) {
      this.mijnTijden = { start: null, finish: null };
      this.mijnGerond = {}; this.serverGerond = {}; this.vorigeRuwe = null; this.wachtend.clear();
      this.meld("Nieuwe race — je tijden zijn automatisch gereset.");
      return;
    }
    if (s.start != null && this.mijnTijden.start == null) this.mijnTijden.start = s.start;
    if (s.finish != null && this.mijnTijden.finish == null) this.mijnTijden.finish = s.finish;
    this.volgGerond(s.gerond);
  }
  private volgGerond(gerond: Gerond) {
    const vorig = this.serverGerond;
    this.serverGerond = gerond;
    if (!vorig) { this.mijnGerond = { ...gerond, ...this.mijnGerond }; return; }
    const baan = this.mijnBaan();
    const nieuw = baan.filter((b) => gerond[b.id] != null && this.mijnGerond[b.id] == null).map((b) => b.label);
    const weg = baan.filter((b) => gerond[b.id] == null && vorig[b.id] != null && !this.wachtend.has(b.id)).map((b) => kleinLabel(b.label));
    const samen: Gerond = { ...gerond };
    this.wachtend.forEach((id) => { if (this.mijnGerond[id] != null && samen[id] == null) samen[id] = this.mijnGerond[id]; });
    this.mijnGerond = samen;
    if (nieuw.length) this.meld(`🟠 ${nieuw.join(", ")} gerond (door een host)`, "goed");
    else if (weg.length && this.mijnTijden.start != null) this.meld(`↩️ Host: ${weg.join(", ")} moet je nog ronden`, "fout");
  }

  // =========================================================
  //  Starten / stoppen (boot claimen, zodat niemand anders jouw boot kan gebruiken)
  // =========================================================
  // Start tracking. Gebruikt een ander toestel de boot al, dan komt { bezet: naam } terug
  // en kan de pagina vragen of je hem wilt overnemen (overnemen = true).
  async start(teamnaam: string, overnemen = false): Promise<{ bezet: string | null } | null> {
    if (!("geolocation" in navigator)) { this.meld("Deze telefoon of browser kan geen GPS gebruiken.", "fout"); return null; }
    initAudio();
    this.vraagMeldingToestemming();
    const boot = this.boot;
    try {
      const r = await this.convex.mutation(api.boot.claim, { groep: this.groep, token: this.token, boot, overnemen });
      if (!r.ok) return { bezet: r.door };
      await this.convex.mutation(api.boot.naam, { groep: this.groep, token: this.token, boot, naam: teamnaam });
    } catch (e) { this.meld(foutTekst(e), "fout"); return null; }
    const s = this.data.boten[boot];
    this.mijnTijden = { start: s?.start ?? null, finish: s?.finish ?? null };
    this.mijnGerond = { ...(s?.gerond || {}) }; this.serverGerond = null; this.wachtend.clear();
    this.vorigeRuwe = null; this.laatsteFix = Date.now();
    this.actief = true;
    this.meld("Tracking gestart. Houd deze pagina open.", "goed");
    await this.vraagWakeLock();
    this.startGps();
    this.opnieuw();
    return null;
  }
  // Stoppen. Is de race voor deze boot niet bezig, dan komt de boot ook vrij voor een ander toestel.
  stop(loslaten = true) {
    const midden = this.data.baan.raceStart != null && this.mijnTijden.start != null && this.mijnTijden.finish == null;
    if (loslaten && this.actief && !midden)
      this.convex.mutation(api.boot.loslaten, { groep: this.groep, token: this.token, boot: this.boot }).catch(() => {});
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null; this.actief = false;
    if (this.wakeLock) { this.wakeLock.release().catch(() => {}); this.wakeLock = null; }
    this.mijnSnelheid = this.mijnHeading = null;
    this.wisGpsAlarm();
    this.meld("");
  }
  private async vraagWakeLock() {
    try {
      this.wakeLock = await navigator.wakeLock.request("screen");
      this.wakeLock.addEventListener("release", () => { this.wakeLock = null; });
    } catch { /* niet ondersteund */ }
  }
  // GPS-bewaking (her)starten. Na "locatie uit" stopt watchPosition in sommige
  // browsers voorgoed; daarom herstarten we hem zolang er geen positie komt.
  private startGps() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = navigator.geolocation.watchPosition((p) => this.opPositie(p), (e) => this.opFout(e), GPS_OPTIES);
    this.laatsteHerstart = Date.now();
  }
  zichtbaarheid(zichtbaar: boolean) {
    if (zichtbaar) {
      this.verborgenSinds = null; this.achtergrondGemeld = false;
      if (this.actief && !this.wakeLock) this.vraagWakeLock();
    } else if (this.actief) this.verborgenSinds = Date.now();
  }
  // Elke 5 s: GPS-waakhond en de melding als de pagina op de achtergrond staat
  waakhond() {
    if (!this.actief) return;
    const stil = Date.now() - this.laatsteFix;
    if (stil > 20000) {
      this.zetGpsAlarm(this.laatsteGpsFout === 1 ? "Locatie staat uit of is geweigerd" : "Geen GPS-signaal meer",
        this.laatsteGpsFout === 1 ? "Zet locatie aan en geef deze site toestemming." : "Er komt al 20 seconden geen positie binnen. Staat locatie aan?");
      if (Date.now() - this.laatsteHerstart > 15000) this.startGps();
    }
    if (this.verborgenSinds && Date.now() - this.verborgenSinds > 15000 && !this.achtergrondGemeld) {
      this.achtergrondGemeld = true;
      this.stuurMelding("Zeilrace-tracker staat op de achtergrond", "Open de app weer, anders wordt je positie mogelijk niet verstuurd.");
    }
  }

  // ---- Positie ----
  private opPositie(p: GeolocationPosition) {
    const { latitude, longitude, accuracy, speed, heading } = p.coords;
    const nu = Date.now();
    this.laatsteFix = nu; this.laatsteGpsFout = null;
    this.wisGpsAlarm();
    this.mijnPositie = { lat: latitude, lng: longitude };
    this.nauwkeurigheid = accuracy;
    const spd = speed != null && !isNaN(speed) ? speed : null;
    const hdg = heading != null && !isNaN(heading) ? heading : null;
    // Koers onthouden voor het kanon: uit de GPS, anders uit de laatste 8+ meter vaart
    if (hdg != null && spd != null && spd > 0.4) this.mijnKoers = hdg;
    if (!this.koersVan) this.koersVan = this.mijnPositie;
    else if (afstandMeter(this.koersVan, this.mijnPositie) > 8) {
      if (hdg == null || spd == null || spd <= 0.4) this.mijnKoers = peiling(this.koersVan, this.mijnPositie);
      this.koersVan = this.mijnPositie;
    }
    this.mijnSnelheid = spd; this.mijnHeading = hdg;
    this.checkKruising({ lat: latitude, lng: longitude, ts: nu, acc: accuracy });
    this.opnieuw();
    if (nu - this.laatsteSchrijf < SCHRIJF_INTERVAL) return;       // throttle (alleen DB-schrijven)
    this.laatsteSchrijf = nu;
    // Positie altijd (live stip); spoor alleen tijdens een race (er staat een startsein)
    // of een zeeslag (aftellen of bezig), voor de replay achteraf
    const st = this.spelStand, spoor = this.data.baan.raceStart != null || !!(st.wacht || st.bezig);
    this.schrijf(this.convex.mutation(api.boot.positie, { groep: this.groep, token: this.token, boot: this.boot, spoor, lat: latitude, lng: longitude, ts: nu,
      acc: accuracy, ...(spd != null ? { speed: spd } : {}), ...(hdg != null ? { heading: hdg } : {}) }));
  }
  // Losse GPS-fouten (Android meldt die soms tussen goede posities door) geven
  // géén alarm: de waakhond slaat pas alarm na 20 s zonder positie.
  // Alleen geweigerde toestemming zonder recente positie meldt meteen.
  private opFout(err: GeolocationPositionError) {
    this.laatsteGpsFout = err.code;
    if (err.code === 1 && Date.now() - this.laatsteFix > 5000)
      this.zetGpsAlarm("Locatie staat uit of is geweigerd", "Zet locatie aan en geef deze site toestemming.");
  }

  // =========================================================
  //  Detectie: startlijn, boeien (rondingslijn), finish
  // =========================================================
  private checkBoei(huidig: Fix) {
    const baan = this.mijnBaan(), lijnen = this.data.baan.lines;
    if (this.mijnTijden.start == null || this.mijnTijden.finish != null || !baan.length || !this.vorigeRuwe) return;
    const v = baan.findIndex((b) => this.mijnGerond[b.id] == null);
    if (v === -1) return;
    const { prev, next } = boeiPrevNext(v, baan, lijnen);
    const marge = Math.min(huidig.acc || 10, RONDINGS_MARGE_MAX_M);
    const lijn = rondingsLijn(baan[v], prev, next, marge, RONDINGS_LIJN_M);
    if (!lijn || !lijnstukkenKruisen(this.vorigeRuwe, huidig, lijn.a, lijn.b)) return;
    const id = baan[v].id;
    this.mijnGerond[id] = huidig.ts;
    this.wachtend.add(id);
    this.schrijf(this.convex.mutation(api.boot.gerond, { groep: this.groep, token: this.token, boot: this.boot, id, ts: huidig.ts })).finally(() => this.wachtend.delete(id));
    speel(GELUID.boei);
    this.meld(`🟠 ${baan[v].label} gerond om ${formatKlok(huidig.ts)}`, "goed");
  }
  private checkKruising(huidig: Fix) {
    if (!this.actief) return;
    if (!this.vorigeRuwe) { this.vorigeRuwe = huidig; return; }
    const A = this.vorigeRuwe, B = huidig, { lines, voorstel, raceStart } = this.data.baan;
    // Startlijn: eerste kruising ná jouw startsein (zonder sein: meteen; niet zolang er een startvoorstel open staat)
    if (heeftLijn(lines.start) && this.mijnTijden.start == null && !(voorstel && raceStart == null)) {
      const t0 = this.mijnStart();
      if ((t0 == null || huidig.ts >= t0) && lijnstukkenKruisen(A, B, lines.start.a, lines.start.b)) {
        this.mijnTijden.start = huidig.ts;
        this.wachtend.add("start");
        this.schrijf(this.convex.mutation(api.boot.start, { groep: this.groep, token: this.token, boot: this.boot, ts: huidig.ts })).finally(() => this.wachtend.delete("start"));
        speel(GELUID.startlijn);
        this.meld("✓ Startlijn gepasseerd om " + formatKlok(huidig.ts), "goed");
      }
    }
    this.checkBoei(huidig);
    // Finish: pas na de start én als alle boeien gerond zijn
    const alleGerond = this.mijnBaan().every((b) => this.mijnGerond[b.id] != null);
    if (heeftLijn(lines.finish) && this.mijnTijden.start != null && this.mijnTijden.finish == null && alleGerond &&
        lijnstukkenKruisen(A, B, lines.finish.a, lines.finish.b)) {
      this.mijnTijden.finish = huidig.ts;
      this.schrijf(this.convex.mutation(api.boot.finish, { groep: this.groep, token: this.token, boot: this.boot, ts: huidig.ts }));
      speel(GELUID.finish);
      this.meld("🏁 Gefinisht om " + formatKlok(huidig.ts), "goed");
      const t0 = this.mijnStart() ?? this.mijnTijden.start;
      Feest.start({ titel: "🏁 Gefinisht!", sub: `${this.naam} · verzeild ${formatDuur(huidig.ts - t0)}` });
    }
    this.vorigeRuwe = huidig;
  }

  // ---- Akkoord met het startvoorstel ----
  async akkoord() {
    const v = this.data.baan.voorstel;
    if (!v || !this.actief || v.t <= Date.now()) return;
    initAudio();
    try {
      const r = await this.convex.mutation(api.boot.akkoord, { groep: this.groep, token: this.token, boot: this.boot, voorstelId: v.id });
      if (r.vast) this.meld(`🔒 Iedereen akkoord: de start ligt vast om ${formatKlok(v.t)}.`, "goed");
    } catch (e) { this.meld(foutTekst(e), "fout"); }
  }

  // =========================================================
  //  GPS-alarm + meldingen
  // =========================================================
  meldStatus() {
    return !("Notification" in window) ? "niet ondersteund"
      : ({ granted: "aan", denied: "geweigerd", default: "nog niet gevraagd" } as Record<string, string>)[Notification.permission];
  }
  private async vraagMeldingToestemming() {
    if ("Notification" in window && Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch { /* */ }
    }
    this.opnieuw();
  }
  private stuurMelding(titel: string, tekst: string) {
    if (document.visibilityState === "visible") return;       // op het scherm zie je het alarm al
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const opts = { body: tekst, tag: "zeilrace-gps", renotify: true, requireInteraction: true, vibrate: [400, 150, 400] } as NotificationOptions;
    if (this.swReg?.showNotification) this.swReg.showNotification(titel, opts).catch(() => {});
    else { try { new Notification(titel, opts); } catch { /* */ } }
  }
  private alarmSignaal() {
    speel(GELUID.alarm);
    navigator.vibrate?.([400, 150, 400, 150, 400]);
  }
  private zetGpsAlarm(titel: string, uitleg: string) {
    if (this.gpsAlarm?.titel === titel) return;
    this.gpsAlarm = { titel, uitleg }; this.alarmStil = false;
    this.alarmSignaal();
    if (this.alarmTimer) clearInterval(this.alarmTimer);
    this.alarmTimer = setInterval(() => { if (!this.alarmStil) this.alarmSignaal(); }, 10000);
    this.stuurMelding("Zeilrace: " + titel, uitleg);
    this.opnieuw();
  }
  private wisGpsAlarm() {
    if (!this.gpsAlarm) return;
    this.gpsAlarm = null;
    if (this.alarmTimer) clearInterval(this.alarmTimer);
    this.alarmTimer = null;
    speel(GELUID.hersteld);                            // één scheepsbel: GPS is terug
    this.opnieuw();
  }
  alarmStilte() { this.alarmStil = true; }

  // =========================================================
  //  Het piratenspel: vuur het kanon!
  // =========================================================
  // Klaar met herladen: 1 minuut na je laatste salvo (uit de database, dus ook na herladen
  // van de pagina), een halve minuut tijdens 'snel herladen'
  herlaadKlaar(mij: Piraat.BootStand | undefined) {
    return Math.max(this.herladenTot, mij && mij.laatsteSchot ? mij.laatsteSchot + Piraat.herlaadDuur(mij, mij.laatsteSchot) : 0);
  }
  // Na een treffer ligt je kanon 1 minuut stil, na een boobytrap 5 minuten
  geraaktKlaar(mij: Piraat.BootStand | undefined) { return (mij?.geraakt || 0) + SPEL.geraaktMs; }
  stilKlaar(mij: Piraat.BootStand | undefined) { return Math.max(this.geraaktKlaar(mij), mij ? mij.valTot : 0); }

  async vuur(tip: (t: string) => void) {
    initAudio();
    const st = this.spelStand, ik = this.boot;
    if (!st.bezig) return;
    if (!this.actief) { tip("Start eerst de tracking — dan weet het kanon waar je schip ligt."); return; }
    const mij = st.boten[ik];
    if (mij.levens <= 0) { tip("Je schip is gezonken… ☠️"); return; }
    if (Date.now() < this.herlaadKlaar(mij) || Date.now() < this.stilKlaar(mij)) return;
    const nr = vrijNummer(this.data.spel?.schoten?.[ik], SPEL.schoten);
    if (nr == null || mij.gebruikt >= SPEL.schoten) { tip("Je kruit is op!"); return; }
    if (!this.mijnPositie || this.mijnKoers == null) { tip("Vaar eerst een stukje: het kanon moet weten waar je boeg wijst."); return; }
    const schot: Schot = { ts: Date.now(), lat: +this.mijnPositie.lat.toFixed(6), lng: +this.mijnPositie.lng.toFixed(6), koers: Math.round(this.mijnKoers) % 360 };
    const vlag = mij.lading ? Piraat.SCHOT_VLAG[mij.lading] : undefined, lading = vlag && mij.lading ? BUIT[mij.lading] : null;
    if (vlag) schot[vlag] = true;                          // lading uit een kist: verder, breder of ook vooruit
    // Raak? Met de laatst bekende posities van de andere (levende) schepen
    const raak: Record<string, boolean> = {};
    st.deelnemers.forEach((b) => {
      const s = this.data.posities[b];
      if (b === ik || st.boten[b].levens <= 0 || !s || Date.now() - s.ts > 20000) return;
      if (Piraat.raakt(schot, s)) raak[b] = true;
    });
    if (Object.keys(raak).length) schot.raak = raak;
    this.herladenTot = Date.now() + Piraat.herlaadDuur(mij, Date.now());
    navigator.vibrate?.(120);
    try { await this.convex.mutation(api.spel.schot, { groep: this.groep, token: this.token, boot: ik, nr: String(nr), schot }); }
    catch (e) { this.herladenTot = 0; this.meld(foutTekst(e), "fout"); return; }
    const n = this.data.naamVan;
    const geraakt = Object.keys(raak).filter((b) => !st.boten[b].schild), afgekaatst = Object.keys(raak).filter((b) => st.boten[b].schild);
    if (geraakt.length) this.meld(`🎯 Raak! ${geraakt.map(n).join(" en ")} ${geraakt.length > 1 ? "zijn" : "is"} geraakt!` +
      (afgekaatst.length ? ` Het schild van ${afgekaatst.map(n).join(" en ")} ving de kogel op.` : ""), "goed");
    else if (afgekaatst.length) this.meld(`🛡️ Het schild van ${afgekaatst.map(n).join(" en ")} ving je kogel op.`);
    else if (lading) this.meld(`${lading.icoon} Je salvo met ${lading.naam} raakte niets.`);
  }

  // Een zeemijn leggen (uit een kist): wie er later binnen 25 m langs vaart, verliest een leven
  async legMijn(tip: (t: string) => void) {
    const st = this.spelStand, ik = this.boot, mij = st.boten[ik];
    if (!st.bezig || !this.actief || !mij || mij.levens <= 0 || mij.lading !== "mijn") return;
    if (!this.mijnPositie) { tip("Nog geen GPS-positie: waar moet de mijn liggen?"); return; }
    const nr = vrijNummer(this.data.spel?.mijnen?.[ik], SPEL.maxMijnen);
    if (nr == null) { tip("Je hebt al 10 mijnen gelegd!"); return; }
    try {
      await this.convex.mutation(api.spel.mijn, { groep: this.groep, token: this.token, boot: ik, nr: String(nr),
        mijn: { ts: Date.now(), lat: +this.mijnPositie.lat.toFixed(6), lng: +this.mijnPositie.lng.toFixed(6) } });
      this.meld("💣 Zeemijn gelegd. Jij kunt er gerust overheen varen, de anderen niet.", "goed");
      navigator.vibrate?.(80);
    } catch (e) { this.meld(foutTekst(e), "fout"); }
  }

  // Elke seconde tijdens een zeeslag: veld, kisten en mijnen
  spelTik() {
    if (!this.data.spel) return;
    this.controleerVeld(); this.controleerKist(); this.controleerMijn();
  }
  // Over de mijn van een ander gevaren? Dat meldt je eigen tracker (die weet precies waar je bent).
  private controleerMijn() {
    const st = this.spelStand, ik = this.boot, pos = this.mijnPositie;
    if (!st.bezig || !this.actief || !pos || !st.deelnemers.includes(ik) || st.boten[ik].levens <= 0) return;
    st.mijnen.filter((m) => m.actief && m.boot !== ik && !this.mijnGemeld.has(st.start + "/" + m.id) && afstandMeter(m, pos) <= SPEL.mijnM)
      .forEach((m) => {
        this.mijnGemeld.add(st.start + "/" + m.id);
        this.schrijf(this.convex.mutation(api.spel.mijnraak, { groep: this.groep, token: this.token, boot: ik, mijnId: m.id, ts: Date.now() }));
      });
  }
  // Buiten het speelveld: elke 20 seconden een leven kwijt
  private controleerVeld() {
    const st = this.spelStand, ik = this.boot, pos = this.mijnPositie;
    const meedoen = st.bezig && st.veld && this.actief && pos && st.deelnemers.includes(ik) && st.boten[ik].levens > 0;
    // het speelveld krimpt na een tijdje: altijd de straal van nu
    if (!meedoen || Piraat.binnenVeld(Piraat.veldOp(st.veld, st.start, Date.now()), pos!)) { this.buitenSinds = null; return; }
    const nu = Date.now();
    if (!this.buitenSinds) this.buitenSinds = nu;
    if (SPEL.strafMs - (nu - this.buitenSinds) > 0) return;
    this.buitenSinds = nu;
    const nr = vrijNummer(this.data.spel?.straf?.[ik], SPEL.levens);
    if (nr == null) return;
    this.schrijf(this.convex.mutation(api.spel.straf, { groep: this.groep, token: this.token, boot: ik, nr: String(nr), ts: nu }));
    speel(GELUID.alarm);
    navigator.vibrate?.([300, 100, 300]);
  }
  // Schatkisten: vaar er binnen 50 m langs en je krijgt wat erin zit. Wie de kist het eerst in de database zet, heeft hem.
  private controleerKist() {
    const st = this.spelStand, ik = this.boot, pos = this.mijnPositie;
    if (this.kistBezig || !st.bezig || !this.actief || !pos || !st.deelnemers.includes(ik)) return;
    const mij = st.boten[ik];
    if (mij.levens <= 0 || mij.lading) return;                     // met lading aan boord pak je geen kist
    const k = Piraat.kisten(this.data.spel, Date.now()).find((x) => !this.kistMislukt.has(st.start + "/" + x.nr) && afstandMeter(x, pos) <= SPEL.kistPakM);
    if (!k) return;
    this.kistBezig = true;
    const start = this.data.spel!.start!;
    this.convex.mutation(api.spel.kist, { groep: this.groep, token: this.token, boot: ik, nr: k.nr, ts: Date.now() })
      .then((r) => {
        if (!r.gepakt) return;
        const soort = Piraat.inhoud({ start }, k.nr), b = BUIT[soort];
        this.meld(`${b.icoon} ${groteLetter(b.naam)}! ${b.tekst}`, soort === "val" ? "fout" : "goed");
        if (soort === "val") { kanonschot(); navigator.vibrate?.([300, 100, 300]); }
        else { scheepsbel(1); navigator.vibrate?.([80, 60, 80]); }
      })
      .catch((e) => { this.kistMislukt.add(st.start + "/" + k.nr); this.meld(foutTekst(e), "fout"); })
      .finally(() => { this.kistBezig = false; });
  }
  // Na elke nieuwe stand: krimpen, geraakt, einde van de zeeslag (alleen wat je hier ziet gebeuren)
  volgSpel() {
    const st = this.spelStand, ik = this.boot, mij = st.boten[ik], nu = Date.now();
    // het krimpen begint: één keer de scheepsbel (drie glazen) en een melding
    const krimpT = st.start && st.veld ? st.start + SPEL.krimpNaMs : null;
    if (krimpT && st.bezig && this.vorigeKrimpCheck != null && this.vorigeKrimpCheck < krimpT && nu >= krimpT) {
      speel(() => scheepsbel(3)); this.meld("🌀 Het speelveld begint te krimpen! Blijf binnen de rode cirkel.", "fout");
    }
    this.vorigeKrimpCheck = nu;
    if (!st.start || !mij) { this.vorigBezig = { start: st.start, bezig: st.bezig }; return; }
    // Geraakt? (alleen melden als het tijdens deze sessie gebeurt)
    const v = this.vorigeMij;
    if (v && v.start === st.start && st.deelnemers.includes(ik)) {
      if (mij.levens < v.levens) {
        const doorVeld = mij.straf > v.straf, doorMijn = mij.mijnRaak > v.mijnRaak;
        const nog = `Nog ${mij.levens} ${mij.levens === 1 ? "leven" : "levens"}. Je kanon ligt 1 minuut stil.`;
        this.meld(mij.levens <= 0 ? "☠️ Je schip is gezonken! Het spel is voor jou voorbij."
          : doorVeld ? `⚠️ Buiten het speelveld: een leven kwijt. Nog ${mij.levens}.`
          : doorMijn ? `💣 Op een zeemijn gevaren! ${nog}` : `💥 Geraakt! ${nog}`, "fout");
        if (!doorVeld) navigator.vibrate?.([200, 80, 200, 80, 400]);
      } else if (mij.geblokt > v.geblokt) this.meld("🛡️ Je schild ving een treffer op! Het is nu op.", "goed");
    }
    this.vorigeMij = { start: st.start, levens: mij.levens, straf: mij.straf, mijnRaak: mij.mijnRaak, geblokt: mij.geblokt };
    // Einde van de zeeslag (alleen als je hem zag eindigen)
    const vb = this.vorigBezig;
    if (vb && vb.start === st.start && vb.bezig && !st.bezig && st.winnaar) {
      const ikWin = st.winnaar.boot === ik && !st.gelijk;
      Feest.start({ titel: ikWin ? "🏴‍☠️ Jij wint de zeeslag!" : "🏴‍☠️ De zeeslag is voorbij",
        sub: st.gelijk ? "Onbeslist — gelijke stand aan kop." : `${this.data.naamVan(st.winnaar.boot)} is de schrik van de zeven zeeën!` });
    }
    this.vorigBezig = { start: st.start, bezig: st.bezig };
  }
}
