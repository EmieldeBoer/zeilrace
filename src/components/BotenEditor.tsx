// De boten van een groep invullen: naam, kleur, rating en lengte.
// De rating is de ORC-omrekening (Time-on-Time): 1,000 is gemiddeld, hoger is sneller.
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { BOOT_KLEUREN, MAX_BOTEN, gphNaarRating, ratingNaarGph } from "../../convex/lib/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type BootRegel = { boot?: string; model: string; kleur: string; gph: number; lengte: number };

export const nieuweBoot = (bestaand: BootRegel[]): BootRegel => ({
  model: `Boot ${bestaand.length + 1}`,
  kleur: BOOT_KLEUREN.find((k) => !bestaand.some((b) => b.kleur === k)) ?? BOOT_KLEUREN[bestaand.length % BOOT_KLEUREN.length],
  gph: 600, lengte: 12,
});

export function BotenEditor({ boten, zet }: { boten: BootRegel[]; zet: (b: BootRegel[]) => void }) {
  const wijzig = (i: number, deel: Partial<BootRegel>) => zet(boten.map((b, j) => (j === i ? { ...b, ...deel } : b)));
  const volgendeKleur = (k: string) => BOOT_KLEUREN[(BOOT_KLEUREN.indexOf(k) + 1) % BOOT_KLEUREN.length];
  return (
    <div className="flex flex-col gap-3">
      {boten.map((b, i) => (
        <div key={b.boot ?? `nieuw-${i}`} className="rounded-lg border border-rand bg-card p-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => wijzig(i, { kleur: volgendeKleur(b.kleur) })}
              aria-label={`Kleur van ${b.model} wisselen`} title="Tik voor een andere kleur"
              className="size-11 shrink-0 cursor-pointer rounded-full border-3 border-stip shadow-[0_0_0_2px_#fff_inset]" style={{ background: b.kleur }} />
            <Input value={b.model} maxLength={40} onChange={(e) => wijzig(i, { model: e.target.value })} aria-label="Naam van de boot"
              placeholder="Naam of type, bijv. Sun Odyssey 469" className="h-12 min-w-0 flex-1 text-base font-bold" />
            {boten.length > 1 && (
              <Button type="button" variant="ghost" size="icon-lg" aria-label={`${b.model} weghalen`} onClick={() => zet(boten.filter((_, j) => j !== i))}>
                <Trash2 className="size-5" />
              </Button>
            )}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm font-bold text-muted-foreground">Rating
              <GetalInvoer waarde={+gphNaarRating(b.gph).toFixed(3)} min={0.3} max={3} label={`Rating van ${b.model}`}
                zet={(r) => wijzig(i, { gph: ratingNaarGph(r) })} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-bold text-muted-foreground">Lengte (m)
              <GetalInvoer waarde={b.lengte} min={3} max={40} label={`Lengte van ${b.model}`} zet={(l) => wijzig(i, { lengte: l })} />
            </label>
          </div>
        </div>
      ))}
      {boten.length < MAX_BOTEN && (
        <Button type="button" variant="secondary" size="xl" onClick={() => zet([...boten, nieuweBoot(boten)])}>
          <Plus className="size-5" />Boot toevoegen
        </Button>
      )}
      <p className="text-sm leading-snug text-muted-foreground">
        <b>Rating</b>: hoe snel de boot is, zoals in de ORC-omrekening (Time-on-Time). 1,000 is gemiddeld, hoger is sneller.
        De app rekent er gecorrigeerde tijden en achtervolgingsstarts mee uit. Weet je het niet? Laat 1,000 staan.
        De <b>lengte</b> bepaalt alleen hoe groot het scheepje op de kaart is.</p>
    </div>
  );
}

// Een getal invullen (ook met een komma). De tekst blijft staan tijdens het typen; alleen
// een geldig getal binnen de grenzen wordt doorgegeven. Ongeldig: rode rand.
function GetalInvoer({ waarde, min, max, label, zet }: { waarde: number; min: number; max: number; label: string; zet: (n: number) => void }) {
  const [tekst, setTekst] = useState(String(waarde).replace(".", ","));
  const getal = parseFloat(tekst.replace(",", "."));
  const geldig = getal >= min && getal <= max;
  useEffect(() => { if (Math.abs(getal - waarde) > 1e-6) setTekst(String(waarde).replace(".", ",")); }, [waarde]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Input inputMode="decimal" aria-label={label} aria-invalid={!geldig} value={tekst} className="h-12 text-lg text-foreground"
      onChange={(e) => { setTekst(e.target.value); const n = parseFloat(e.target.value.replace(",", ".")); if (n >= min && n <= max) zet(n); }}
      onBlur={() => { if (!geldig) setTekst(String(waarde).replace(".", ",")); }} />
  );
}
