// Het geheime toesteltoken van deze telefoon. Wie een boot claimt (Start tracking),
// koppelt hem aan dit token; daarna mag alleen deze telefoon voor die boot schrijven.
// Vervangt het anonieme inloggen van Firebase.
const SLEUTEL = "zeilrace-toestel";
let geheugen: string | null = null;

export function toestelToken(): string {
  try {
    const t = localStorage.getItem(SLEUTEL);
    if (t) return t;
  } catch { /* privémodus: alleen in het geheugen */ }
  if (!geheugen) {
    const b = new Uint8Array(24);
    crypto.getRandomValues(b);
    geheugen = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }
  try { localStorage.setItem(SLEUTEL, geheugen); } catch { /* privémodus */ }
  return geheugen;
}
