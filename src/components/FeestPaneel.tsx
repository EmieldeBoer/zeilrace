// Het paneel bij het feest (finish, winst van de zeeslag): titel, regel eronder
// en de knoppen 'Meer vuurwerk!' en 'Sluiten'. De confetti en het vuurwerk zelf
// tekent src/lib/feest.ts op een eigen canvas.
import { Button } from "@/components/ui/button";
import { Feest, useFeestPaneel } from "@/lib/feest";

export function FeestPaneel() {
  const { open, titel, sub } = useFeestPaneel();
  if (!open) return null;
  return (
    // translate(-50%,-50%) staat ook inline: de animatie .feest-in houdt hem alleen tijdens het inzoomen vast
    <div role="dialog" aria-label={titel} style={{ transform: "translate(-50%, -50%)" }}
      className="plaquette feest-in fixed left-1/2 top-1/2 z-[4001] w-[min(92vw,430px)] rounded-lg px-5 pt-[22px] pb-[18px] text-center font-sans">
      <div className="titel text-[clamp(2rem,9vw,2.9rem)]">
        {titel}
      </div>
      <div className="mt-2 text-foreground text-lg">{sub}</div>
      <div className="mt-4 flex gap-2.5">
        <Button type="button" variant="default" className="flex-1 min-h-[52px] font-kop font-bold text-base" onClick={() => Feest.meer()}>
          🎆 Meer vuurwerk!
        </Button>
        <Button type="button" variant="secondary" className="basis-[34%] shrink-0 min-h-[52px] font-kop font-bold text-base" onClick={() => Feest.stop()}>
          Sluiten
        </Button>
      </div>
    </div>
  );
}
