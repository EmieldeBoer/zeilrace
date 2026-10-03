// Vragen aan de gebruiker in een dialoog (in plaats van confirm/prompt/alert):
//   const { bevestig, invoer, melding } = useBevestig();
//   if (!(await bevestig({ titel: "Race afronden?", tekst: "…" }))) return;
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";

type Opties = { titel: string; tekst?: ReactNode; ok?: string; annuleer?: string; gevaar?: boolean };
type Vraag =
  | (Opties & { soort: "bevestig"; klaar: (v: boolean) => void })
  | (Opties & { soort: "melding"; klaar: () => void })
  | (Opties & { soort: "invoer"; standaard?: string; max?: number; klaar: (v: string | null) => void });

type Api = {
  bevestig: (o: Opties) => Promise<boolean>;
  melding: (o: Opties) => Promise<void>;
  invoer: (o: Opties & { standaard?: string; max?: number }) => Promise<string | null>;
};
const Ctx = createContext<Api | null>(null);

export function BevestigProvider({ children }: { children: ReactNode }) {
  const [rij, setRij] = useState<Vraag[]>([]);
  const [waarde, setWaarde] = useState("");
  const huidig = rij[0];
  const klaarRef = useRef(false);

  const zet = useCallback((v: Vraag) => setRij((r) => [...r, v]), []);
  const api = useMemo<Api>(() => ({
    bevestig: (o) => new Promise((klaar) => zet({ ...o, soort: "bevestig", klaar })),
    melding: (o) => new Promise((klaar) => zet({ ...o, soort: "melding", klaar })),
    invoer: (o) => new Promise((klaar) => { setWaarde(o.standaard ?? ""); zet({ ...o, soort: "invoer", klaar }); }),
  }), [zet]);

  const sluit = (ok: boolean) => {
    if (!huidig || klaarRef.current) return;
    klaarRef.current = true;
    if (huidig.soort === "bevestig") huidig.klaar(ok);
    else if (huidig.soort === "invoer") huidig.klaar(ok ? waarde : null);
    else huidig.klaar();
    setRij((r) => r.slice(1));
    setTimeout(() => { klaarRef.current = false; }, 0);
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      <AlertDialog open={!!huidig} onOpenChange={(open) => { if (!open) sluit(false); }}>
        {huidig && (
          <AlertDialogContent className="sm:max-w-md data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle className="font-kap text-lg font-bold">{huidig.titel}</AlertDialogTitle>
              {huidig.tekst && (
                <AlertDialogDescription className="text-base whitespace-pre-line text-inkt">{huidig.tekst}</AlertDialogDescription>
              )}
            </AlertDialogHeader>
            {huidig.soort === "invoer" && (
              <Input autoFocus value={waarde} maxLength={huidig.max} onChange={(e) => setWaarde(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sluit(true); }} className="h-11 text-base" />
            )}
            <AlertDialogFooter>
              {huidig.soort !== "melding" && <AlertDialogCancel variant="secondary">{huidig.annuleer ?? "Annuleren"}</AlertDialogCancel>}
              <AlertDialogAction variant={huidig.gevaar ? "destructive" : "default"} onClick={() => sluit(true)}>
                {huidig.ok ?? "OK"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </Ctx.Provider>
  );
}

export function useBevestig(): Api {
  const api = useContext(Ctx);
  if (!api) throw new Error("useBevestig buiten BevestigProvider");
  return api;
}
