// De groep: je naam, uitnodigen, de leden (en wie host is), de boten en de spelvormen.
// Leden zien alles; hosts kunnen het ook aanpassen.
import { useMutation } from "convex/react";
import { Crown, LogOut, UserMinus } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { gphNaarRating } from "../../convex/lib/config";
import { BootStip } from "@/components/BootKaart";
import { BotenEditor, type BootRegel } from "@/components/BotenEditor";
import { useBevestig } from "@/components/Bevestig";
import { DelenInhoud } from "@/components/Delen";
import { GroepBalk } from "@/components/GroepBalk";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useGroep } from "@/hooks/useGroep";
import { foutTekst } from "@/lib/fouten";

const Sectie = ({ titel, children }: { titel: string; children: React.ReactNode }) => (
  <Card><CardContent className="flex flex-col gap-3">
    <h2 className="font-kop text-xl font-extrabold [font-stretch:var(--kop-rek)]">{titel}</h2>{children}
  </CardContent></Card>
);

export default function Groep() {
  const { groep, token, isHost, leden, mijnNaam, race } = useGroep();
  const navigate = useNavigate();
  const { bevestig } = useBevestig();
  const m = {
    naam: useMutation(api.groepen.mijnNaam), instellingen: useMutation(api.groepen.instellingen),
    boten: useMutation(api.groepen.bewaarBoten), rol: useMutation(api.groepen.zetRol),
    weg: useMutation(api.groepen.verwijderLid), verlaat: useMutation(api.groepen.verlaat),
  };
  const doe = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toast.success(ok); return true; } catch (e) { toast.error(foutTekst(e)); return false; }
  };
  const [naam, setNaam] = useState(mijnNaam ?? "");
  const [groepNaam, setGroepNaam] = useState(groep.naam);
  useEffect(() => setGroepNaam(groep.naam), [groep.naam]);
  const opgeslagen: BootRegel[] = race.vloot.map(({ boot, model, kleur, gph, lengte }) => ({ boot, model, kleur, gph, lengte }));
  const [boten, setBoten] = useState<BootRegel[] | null>(null);
  const gewijzigd = boten && JSON.stringify(boten) !== JSON.stringify(opgeslagen);

  const bewaarBoten = async () => {
    if (!boten) return;
    const weg = opgeslagen.filter((b) => !boten.some((x) => x.boot === b.boot)).map((b) => b.model);
    if (weg.length && !(await bevestig({ titel: "Boten weghalen?", gevaar: true, ok: "Opslaan",
      tekst: `${weg.join(", ")} ${weg.length > 1 ? "verdwijnen" : "verdwijnt"} uit de groep. Oude uitslagen blijven bewaard.` }))) return;
    if (await doe(() => m.boten({ token, groep: groep.id, boten }), "Boten opgeslagen.")) setBoten(null);
  };

  return (
    <div className="flex min-h-full flex-col">
      <GroepBalk waar="groep" />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-5">
        <Sectie titel="Jij">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); doe(() => m.naam({ token, naam }), "Naam opgeslagen."); }}>
            <Input value={naam} onChange={(e) => setNaam(e.target.value)} maxLength={30} aria-label="Jouw naam" placeholder="Jouw naam" className="h-12 flex-1 text-lg" />
            <Button type="submit" size="lg" disabled={!naam.trim() || naam === mijnNaam}>Opslaan</Button>
          </form>
          <p className="text-muted-foreground">Je bent {isHost ? "host" : "lid"} van deze groep.
            {isHost ? " Je zet de baan uit, rondt races af en beheert de groep." : " Je kijkt live mee, vaart mee en kunt een start voorstellen."}</p>
        </Sectie>

        <Sectie titel="Uitnodigen"><DelenInhoud /></Sectie>

        <Sectie titel={`Leden (${leden.length})`}>
          <ul className="flex flex-col divide-y divide-lijn">
            {leden.map((l) => (
              <li key={l.id} className="flex min-h-14 items-center gap-2 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{l.naam || "Naamloos"}{l.ikZelf && " (jij)"}</span>
                  <span className="text-sm text-muted-foreground">{l.rol === "host" ? "👑 Host" : "Lid"}
                    {l.boten.length > 0 && <> · vaart op {l.boten.map((b) => race.naamVan(b)).join(", ")}</>}</span>
                </span>
                {isHost && !l.ikZelf && <>
                  <Button variant="secondary" size="sm" onClick={() => doe(() => m.rol({ token, groep: groep.id, lid: l.id as Id<"leden">, rol: l.rol === "host" ? "lid" : "host" }))}>
                    <Crown className="size-4" />{l.rol === "host" ? "Maak lid" : "Maak host"}</Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`${l.naam || "Lid"} uit de groep halen`}
                    onClick={async () => { if (await bevestig({ titel: `${l.naam || "Dit lid"} uit de groep halen?`, gevaar: true, ok: "Verwijderen",
                      tekst: "Met de uitnodigingslink kan die wel opnieuw meedoen. Maak eventueel een nieuwe link." }))
                      await doe(() => m.weg({ token, groep: groep.id, lid: l.id as Id<"leden"> })); }}>
                    <UserMinus className="size-4" /></Button>
                </>}
              </li>
            ))}
          </ul>
        </Sectie>

        <Sectie titel="Boten">
          {isHost ? <>
            <BotenEditor boten={boten ?? opgeslagen} zet={setBoten} />
            {gewijzigd && <div className="flex gap-2 [&>*]:flex-1">
              <Button size="xl" variant="groen" onClick={bewaarBoten}>Boten opslaan</Button>
              <Button size="xl" variant="secondary" onClick={() => setBoten(null)}>Annuleren</Button>
            </div>}
          </> : (
            <ul className="flex flex-col divide-y divide-lijn">
              {race.vloot.map((b) => (
                <li key={b.boot} className="flex min-h-12 items-center gap-3 py-2">
                  <BootStip boot={b.boot} className="size-5" />
                  <span className="flex-1 font-bold">{b.model}</span>
                  <span className="text-muted-foreground">rating {gphNaarRating(b.gph).toFixed(3)}</span>
                </li>
              ))}
            </ul>
          )}
        </Sectie>

        {isHost && <Sectie titel="Groep en spelvormen">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); doe(() => m.instellingen({ token, groep: groep.id, naam: groepNaam }), "Naam van de groep opgeslagen."); }}>
            <Input value={groepNaam} onChange={(e) => setGroepNaam(e.target.value)} maxLength={50} aria-label="Naam van de groep" className="h-12 flex-1 text-lg" />
            <Button type="submit" size="lg" disabled={!groepNaam.trim() || groepNaam === groep.naam}>Opslaan</Button>
          </form>
          <label className="flex min-h-14 cursor-pointer items-center gap-4 rounded-lg border border-rand p-3">
            <Switch checked={groep.piraat} onCheckedChange={(aan) => doe(() => m.instellingen({ token, groep: groep.id, piraat: aan }),
              aan ? "Piratenmodus aan. Arr!" : "Piratenmodus uit.")} />
            <span><b>🏴‍☠️ Piratenmodus</b><br /><span className="text-muted-foreground">Het piratenthema en de zeeslag (kanonnen, schatkisten,
              een krimpend speelveld). Geldt voor de hele groep.</span></span>
          </label>
        </Sectie>}

        <Button variant="secondary" size="xl" className="mt-2"
          onClick={async () => { if (await bevestig({ titel: "Groep verlaten?", gevaar: true, ok: "Verlaten",
            tekst: "Je kunt later opnieuw meedoen met de uitnodigingslink." }) && await doe(() => m.verlaat({ token, groep: groep.id }))) navigate("/"); }}>
          <LogOut className="size-5" />Groep verlaten</Button>
      </main>
    </div>
  );
}
