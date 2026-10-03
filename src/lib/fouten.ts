import { ConvexError } from "convex/values";

// Leesbare foutmelding uit een fout van de server of het netwerk
export function foutTekst(e: unknown): string {
  if (e instanceof ConvexError) return typeof e.data === "string" ? e.data : JSON.stringify(e.data);
  const t = e instanceof Error ? e.message : String(e);
  if (/network|fetch|connection/i.test(t)) return "Geen verbinding met de server.";
  // Serverfouten zonder ConvexError: alleen de eerste regel, zonder stacktrace
  return t.replace(/^\[CONVEX [^\]]+\]\s*/, "").replace(/^Server Error\s*/i, "").split("\n")[0] || "Er ging iets mis.";
}
