// Het geheime toesteltoken van deze browser. Het is je identiteit in de app: met dit
// token ben je lid of host van groepen en claim je een boot. De server bewaart
// alleen een hash ervan. Wie het token kent, kan doen wat jij mag: deel het dus niet.
const SLEUTEL = "zeilrace-toestel";
let geheugen: string | null = null;

export function toestelToken(): string {
  try {
    const t = localStorage.getItem(SLEUTEL);
    if (t && t.length >= 32) return t;
  } catch { /* privémodus: alleen in het geheugen */ }
  if (!geheugen) {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    geheugen = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }
  try { localStorage.setItem(SLEUTEL, geheugen); } catch { /* privémodus */ }
  return geheugen;
}
