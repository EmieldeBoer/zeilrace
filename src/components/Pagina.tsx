// Bouwstenen voor pagina's: de bovenbalk met het merk, een knop die een link is, laden
import { Sailboat } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";

// Een eenvoudige pagina: de bovenbalk met het merk en een smalle kolom
export function Kaal({ children, terug }: { children: ReactNode; terug?: string }) {
  return (
    <div className="min-h-full">
      <header className="balk">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          {terug && <Link to={terug} className="text-2xl leading-none" aria-label="Terug">←</Link>}
          <Link to="/" className="flex items-center gap-2 font-titel text-xl [font-stretch:var(--titel-rek)]"><Sailboat className="size-6" />Zeilrace</Link>
        </div>
      </header>
      <div className="seinstreep" />
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
export const KnopLink = ({ to, className, variant, size, children }: {
  to: string; className?: string; variant?: "default" | "secondary" | "groen" | "kanon"; size?: "default" | "lg" | "xl"; children: ReactNode;
}) => <Link to={to} className={cn(buttonVariants({ variant, size }), className)}>{children}</Link>;


export const Laden = () => <div className="p-6 text-lg text-muted-foreground">Laden…</div>;
