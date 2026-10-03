// --- Tijd & afstand netjes weergeven ---------------------------

// Tekst veilig in HTML zetten (voor kaartlabels en tooltips van Leaflet;
// React zelf ontsnapt alles al)
export function esc(s: unknown): string {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// milliseconden -> "1:23:45" of "23:45"
export function formatDuur(ms: number | null | undefined): string {
  if (ms == null || ms < 0 || isNaN(ms)) return "—";
  const totaal = Math.floor(ms / 1000);
  const u = Math.floor(totaal / 3600);
  const m = Math.floor((totaal % 3600) / 60);
  const s = totaal % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return u > 0 ? `${u}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// klokstip (unix ms) -> "14:07:23"
export function formatKlok(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("nl-NL", { hour12: false });
}
export function klokHM(ts: number): string {
  return new Date(ts).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}
export function datumKort(ts: number): string {
  return new Date(ts).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// meters → zeemijl (1 zm = 1852 m): 2 decimalen tot 10 zm, daarboven 1
export function formatAfstand(m: number): string {
  const zm = m / 1852;
  return (zm < 10 ? zm.toFixed(2) : zm.toFixed(1)) + " zm";
}
export function geleden(ms: number): string {
  return ms < 60000 ? Math.round(ms / 1000) + " s geleden" : Math.round(ms / 60000) + " min geleden";
}
export const zmTekst = (zm: number) => String(zm).replace(".", ",") + " zm";
export const groteLetter = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// Een lange puntenlijst uitdunnen tot max punten (begin en eind blijven)
export function dunUit<T>(pts: T[], max: number): T[] {
  if (pts.length <= max) return pts;
  const stap = (pts.length - 1) / (max - 1), uit: T[] = [];
  for (let i = 0; i < max; i++) uit.push(pts[Math.round(i * stap)]);
  return uit;
}
