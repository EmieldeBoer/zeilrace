// De groep delen: de code (ook in te typen), een QR-code om te scannen vanaf een
// ander scherm, en de link om te kopiëren of via WhatsApp en dergelijke te sturen.
// Hosts kunnen ook een medehost uitnodigen en een link vervangen.
import { useMutation } from "convex/react";
import { Check, Copy, RefreshCw, Share2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { renderSVG } from "uqr";
import { api } from "../../convex/_generated/api";
import { useBevestig } from "@/components/Bevestig";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { codeTekst, hostLink, lidLink, useGroep } from "@/hooks/useGroep";
import { foutTekst } from "@/lib/fouten";

function Qr({ tekst }: { tekst: string }) {
  const svg = useMemo(() => renderSVG(tekst, { border: 2, whiteColor: "#ffffff", blackColor: "#0b1d33" }), [tekst]);
  return <div aria-label="QR-code met de link" role="img" className="mx-auto w-[min(70vw,240px)] [&_svg]:h-auto [&_svg]:w-full"
    dangerouslySetInnerHTML={{ __html: svg }} />;
}

function DeelKnoppen({ link, titel }: { link: string; titel: string }) {
  const [gekopieerd, setGekopieerd] = useState(false);
  const kopieer = async () => {
    try { await navigator.clipboard.writeText(link); setGekopieerd(true); setTimeout(() => setGekopieerd(false), 2000); }
    catch { toast.error("Kopiëren lukte niet. Houd de link ingedrukt om hem te kopiëren."); }
  };
  const deel = async () => {
    try { await navigator.share({ title: titel, text: titel, url: link }); } catch { /* geannuleerd */ }
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-md border border-rand bg-muted px-3 py-2 font-mono text-sm break-all select-all">{link}</div>
      <div className="flex gap-2 [&>*]:flex-1">
        {"share" in navigator && <Button size="xl" onClick={deel}><Share2 className="size-5" />Delen</Button>}
        <Button size="xl" variant="secondary" onClick={kopieer}>{gekopieerd ? <><Check className="size-5" />Gekopieerd</> : <><Copy className="size-5" />Kopieer</>}</Button>
      </div>
    </div>
  );
}

export function DelenInhoud() {
  const { groep, token, isHost } = useGroep();
  const nieuweLink = useMutation(api.groepen.nieuweLink);
  const { bevestig } = useBevestig();
  const vervang = async (welke: "lid" | "host") => {
    if (!(await bevestig({ titel: welke === "lid" ? "Nieuwe uitnodigingslink maken?" : "Nieuwe hostlink maken?", gevaar: true, ok: "Vervangen",
      tekst: welke === "lid" ? "De huidige link en code werken dan niet meer voor nieuwe leden. Wie al lid is, blijft lid."
        : "De huidige hostlink werkt dan niet meer. Wie al host is, blijft host." }))) return;
    try { await nieuweLink({ groep: groep.id, token, welke }); toast.success("Nieuwe link gemaakt."); }
    catch (e) { toast.error(foutTekst(e)); }
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <div className="font-kop text-sm font-bold tracking-[.1em] text-muted-foreground uppercase">Code</div>
        <div className="font-kop text-[clamp(1.7rem,9vw,2.6rem)] leading-tight font-black tracking-[.08em] whitespace-nowrap [font-stretch:var(--kop-rek)]">{codeTekst(groep.code)}</div>
      </div>
      <Qr tekst={lidLink(groep.code)} />
      <DeelKnoppen link={lidLink(groep.code)} titel={`Doe mee met ${groep.naam} op Zeilrace`} />
      {isHost && groep.hostCode && (
        <Collapsible className="rounded-lg border border-rand p-3">
          <CollapsibleTrigger className="w-full cursor-pointer text-left font-bold">👑 Medehost uitnodigen</CollapsibleTrigger>
          <CollapsibleContent className="mt-2 flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">Wie deze link opent, wordt host: die kan de baan uitzetten, races afronden en de
              groep beheren. Stuur hem alleen naar wie je vertrouwt.</p>
            <DeelKnoppen link={hostLink(groep.hostCode)} titel={`Word host van ${groep.naam} op Zeilrace`} />
            <div className="flex flex-col gap-2 pt-1 sm:flex-row [&>*]:flex-1">
              <Button variant="secondary" onClick={() => vervang("lid")}><RefreshCw className="size-4" />Nieuwe uitnodigingslink</Button>
              <Button variant="secondary" onClick={() => vervang("host")}><RefreshCw className="size-4" />Nieuwe hostlink</Button>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

export function DelenDialoog({ open, setOpen }: { open: boolean; setOpen: (o: boolean) => void }) {
  const { groep } = useGroep();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-md">
        <DialogTitle className="font-kop text-xl font-extrabold">Nodig je vloot uit</DialogTitle>
        <DialogDescription className="text-base">Laat iedereen de QR-code scannen, of stuur de link. Wie hem opent, doet mee met
          <b> {groep.naam}</b>.</DialogDescription>
        <DelenInhoud />
      </DialogContent>
    </Dialog>
  );
}
