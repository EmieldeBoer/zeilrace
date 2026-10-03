// Het begin: je groepen op dit toestel, een nieuwe groep maken of meedoen met een code
import { useQuery } from "convex/react";
import { ChevronRight, Plus } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../../convex/_generated/api";
import { Kaal, KnopLink } from "@/components/Pagina";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toestelToken } from "@/lib/toestel";

export default function Home() {
  const token = useMemo(() => toestelToken(), []);
  const mijn = useQuery(api.groepen.mijn, { token });
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const meedoen = (e: FormEvent) => {
    e.preventDefault();
    const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (c.length === 8) navigate(`/g/${c}`);
  };
  const geldig = code.toUpperCase().replace(/[^A-Z0-9]/g, "").length === 8;

  return (
    <Kaal>
      <section className="mb-7">
        <h1 className="titel text-[clamp(2.4rem,9vw,3.6rem)]">Racen met je vloot</h1>
        <p className="mt-3 max-w-xl text-lg leading-snug text-muted-foreground">
          Elke boot deelt zijn GPS vanaf een telefoon. Zet een baan uit, start samen en zie live wie er voorligt, met rating.
          Geen account nodig: maak een groep en deel de link.</p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="justify-between"><CardContent className="flex h-full flex-col gap-3">
          <h2 className="font-kop text-lg font-extrabold">Nieuwe groep</h2>
          <p className="flex-1 text-muted-foreground">Voor de schipper of de organisatie: zet de boten erin en nodig de rest uit.</p>
          <KnopLink to="/nieuw" size="xl"><Plus className="size-5" />Groep maken</KnopLink>
        </CardContent></Card>
        <Card><CardContent>
          <form onSubmit={meedoen} className="flex h-full flex-col gap-3">
            <h2 className="font-kop text-lg font-extrabold">Meedoen met een code</h2>
            <p className="text-muted-foreground">Kreeg je een code van 8 tekens? Vul hem hier in. Een link kun je gewoon openen.</p>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX" autoCapitalize="characters"
              autoComplete="off" spellCheck={false} maxLength={9} aria-label="Code van de groep"
              className="h-14 text-center font-kop text-2xl font-extrabold tracking-[.2em] uppercase" />
            <Button type="submit" size="xl" variant="groen" disabled={!geldig}>Meedoen</Button>
          </form>
        </CardContent></Card>
      </div>

      {mijn && mijn.groepen.length > 0 && (
        <section className="mt-8">
          <h2 className="sectie-kop">Jouw groepen</h2>
          <div className="flex flex-col gap-2.5">
            {mijn.groepen.map((g) => (
              <Link key={g.code} to={`/g/${g.code}`}
                className="vlak flex min-h-16 items-center gap-3 rounded-lg border border-rand px-4 py-3 hover:border-kader">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg font-bold">{g.naam}</span>
                  <span className="text-sm text-muted-foreground">{g.rol === "host" ? "Host" : "Lid"}{g.piraat ? " · 🏴‍☠️ piratenmodus" : ""}</span>
                </span>
                {g.live && <span className="rounded-full bg-goed px-2.5 py-1 text-xs font-bold text-white">RACE BEZIG</span>}
                <ChevronRight className="size-6 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-9">
        <h2 className="sectie-kop">Zo werkt het</h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {[["1", "Maak een groep", "Geef de boten een naam en (als je die weet) een rating."],
            ["2", "Deel de link", "Iedereen opent hem op zijn telefoon en doet mee."],
            ["3", "Vaar mee", "Op elke boot: kies je boot en druk op Start tracking. De rest gaat vanzelf."]].map(([n, kop, tekst]) => (
            <li key={n} className="vlak rounded-lg border border-rand p-4">
              <span className="font-titel text-3xl text-kop [font-stretch:var(--titel-rek)]">{n}</span>
              <h3 className="mt-1 font-bold">{kop}</h3>
              <p className="text-muted-foreground">{tekst}</p>
            </li>
          ))}
        </ol>
      </section>
    </Kaal>
  );
}
