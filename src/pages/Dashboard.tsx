// ============================================================
//  Zeilrace — dashboard
//  Publiek: kaart, live data per boot, regels, uitslagen.
//  Wedstrijdleiding: open met ?wl en log in met het wachtwoord.
// ============================================================
import { useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNu } from "@/hooks/useNu";
import { useRace } from "@/hooks/useRace";
import { useSporen } from "@/hooks/useSporen";
import { useWl } from "@/hooks/useWl";
import { raceWeergave, zeeslagWeergave, type ReplayData } from "@/lib/uitslag";
import { Live } from "./dashboard/Live";
import { Regels } from "./dashboard/Regels";
import { Replay } from "./dashboard/Replay";
import { Uitslagen, type ReplayKeuze } from "./dashboard/Uitslagen";

type Tab = "live" | "regels" | "uitslagen";

export default function Dashboard() {
  const wlModus = useMemo(() => new URLSearchParams(location.search).has("wl"), []);
  const race = useRace();
  const sporen = useSporen(race.geladen ? race.baan.gen : null);
  const wl = useWl();
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
      <TabsList variant="line" className="h-auto w-full flex-none justify-start gap-0 rounded-none border-b-2 border-messing-donker bg-[linear-gradient(180deg,#120c07,#0a0704)] p-0 pt-[env(safe-area-inset-top)] shadow-[0_2px_0_#000,0_3px_10px_#000a]">
        {([["live", "⚓ Live"], ["regels", "📜 Regels"], ["uitslagen", "🏆 Uitslagen"]] as const).map(([w, t]) => (
          <TabsTrigger key={w} value={w}
            className="h-auto min-h-[52px] flex-none rounded-none border-0 border-b-3 border-transparent px-[22px] py-3 font-kap text-[.95rem] font-bold tracking-[.06em] text-ivoor-zacht after:hidden hover:text-goud data-active:border-messing data-active:bg-transparent data-active:text-goud data-active:[text-shadow:0_0_10px_rgba(240,199,94,.35)] dark:data-active:border-messing dark:data-active:bg-transparent dark:data-active:text-goud max-[820px]:flex-1 max-[820px]:px-1 max-[820px]:text-[.85rem] max-[820px]:tracking-[.03em]">
            {t}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="live" keepMounted className="flex min-h-0 flex-1">
        <Live race={race} sporen={sporen} wl={wl} wlModus={wlModus} nu={nu} actief={tab === "live"} />
      </TabsContent>
      <TabsContent value="regels" className="min-h-0 flex-1 overflow-y-auto p-6 max-[820px]:p-4">
        <Regels />
      </TabsContent>
      <TabsContent value="uitslagen" keepMounted className="min-h-0 flex-1 overflow-y-auto p-6 max-[820px]:p-4">
        {uitslagenGezien && <Uitslagen wl={wl} naamVan={race.naamVan} onReplay={openReplay} />}
      </TabsContent>
      {replay && <Replay data={replay.data} sleutel={replay.sleutel} onSluit={() => setReplay(null)} />}
    </Tabs>
  );
}
