// ============================================================
//  Zeilrace: het dashboard van een groep
//  Live (kaart, boten, start, organisatie), Uitslagen en Regels.
// ============================================================
import { useState } from "react";
import { GroepBalk } from "@/components/GroepBalk";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGroep } from "@/hooks/useGroep";
import { useNu } from "@/hooks/useNu";
import { useSporen } from "@/hooks/useSporen";
import { raceWeergave, zeeslagWeergave, type ReplayData } from "@/lib/uitslag";
import { Live } from "./dashboard/Live";
import { Regels } from "./dashboard/Regels";
import { Replay } from "./dashboard/Replay";
import { Uitslagen, type ReplayKeuze } from "./dashboard/Uitslagen";

type Tab = "live" | "uitslagen" | "regels";

export default function Dashboard() {
  const { groep, token, race } = useGroep();
  const sporen = useSporen(groep.id, token, race.geladen ? race.baan.gen : null);
  const nu = useNu(1000);
  const [tab, setTab] = useState<Tab>("live");
  const [uitslagenGezien, setUitslagenGezien] = useState(false);
  const [replay, setReplay] = useState<{ data: ReplayData; sleutel: string } | null>(null);

  const openReplay = (k: ReplayKeuze) => {
    const data = k.soort === "race" ? raceWeergave(k.res, race.naamVan) : zeeslagWeergave(k.z, race.naamVan);
    if (data) setReplay({ data, sleutel: k.soort === "race" ? "race-" + k.res.nr : "zeeslag-" + k.z.start });
  };

  return (
    <Tabs value={tab} onValueChange={(v) => { setTab(v as Tab); if (v === "uitslagen") setUitslagenGezien(true); }} className="h-full gap-0">
      <GroepBalk waar="dashboard">
        <TabsList variant="line" className="h-auto w-full justify-start gap-0 rounded-none bg-transparent p-0 px-1">
          {([["live", "Live"], ["uitslagen", "Uitslagen"], ["regels", "Regels"]] as const).map(([w, t]) => (
            <TabsTrigger key={w} value={w}
              className="h-auto min-h-12 flex-none rounded-none border-0 border-b-4 border-transparent px-5 py-2.5 font-kop text-[.95rem] font-extrabold tracking-[.04em] text-muted-foreground after:hidden hover:text-foreground data-active:border-[var(--seingeel)] data-active:bg-transparent data-active:text-foreground dark:data-active:border-[var(--seingeel)] dark:data-active:bg-transparent dark:data-active:text-foreground max-[820px]:flex-1 max-[820px]:px-1">
              {t}
            </TabsTrigger>
          ))}
        </TabsList>
      </GroepBalk>
      <TabsContent value="live" keepMounted className="flex min-h-0 flex-1">
        <Live sporen={sporen} nu={nu} actief={tab === "live"} />
      </TabsContent>
      <TabsContent value="uitslagen" keepMounted className="min-h-0 flex-1 overflow-y-auto p-6 max-[820px]:p-4">
        {uitslagenGezien && <Uitslagen onReplay={openReplay} />}
      </TabsContent>
      <TabsContent value="regels" className="min-h-0 flex-1 overflow-y-auto p-6 max-[820px]:p-4">
        <Regels piraat={groep.piraat} />
      </TabsContent>
      {replay && <Replay data={replay.data} sleutel={replay.sleutel} onSluit={() => setReplay(null)} />}
    </Tabs>
  );
}
