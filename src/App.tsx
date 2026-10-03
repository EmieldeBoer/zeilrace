import { Component, lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { BevestigProvider } from "@/components/Bevestig";
import { FeestPaneel } from "@/components/FeestPaneel";
import { Laden } from "@/components/Pagina";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { foutTekst } from "@/lib/fouten";

const Home = lazy(() => import("./pages/Home"));
const NieuweGroep = lazy(() => import("./pages/NieuweGroep"));
const HostUitnodiging = lazy(() => import("./pages/HostUitnodiging"));
const GroepPagina = lazy(() => import("./pages/GroepPagina"));

// Gaat er iets mis bij het laden (geen verbinding, server weg), dan een nette melding
class Vangnet extends Component<{ children: ReactNode }, { fout: unknown }> {
  state = { fout: null as unknown };
  static getDerivedStateFromError(fout: unknown) { return { fout }; }
  render() {
    if (!this.state.fout) return this.props.children;
    return (
      <div className="mx-auto max-w-lg p-6">
        <h1 className="titel text-3xl">Er ging iets mis</h1>
        <p className="mt-3 text-lg">{foutTekst(this.state.fout)}</p>
        <div className="mt-5 flex gap-3">
          <button className="rounded-md bg-primary px-4 py-3 font-bold text-primary-foreground" onClick={() => location.reload()}>Opnieuw laden</button>
          <a className="rounded-md border border-rand px-4 py-3 font-bold" href="/">Naar het begin</a>
        </div>
      </div>
    );
  }
}

export default function App() {
  return (
    <Vangnet>
      <TooltipProvider>
        <BevestigProvider>
          <BrowserRouter>
            <Suspense fallback={<Laden />}>
              <Routes>
                <Route path="/nieuw" element={<NieuweGroep />} />
                <Route path="/host/:hostCode" element={<HostUitnodiging />} />
                <Route path="/g/:code" element={<GroepPagina deel="dashboard" />} />
                <Route path="/g/:code/tracker" element={<GroepPagina deel="tracker" />} />
                <Route path="/g/:code/groep" element={<GroepPagina deel="groep" />} />
                <Route path="*" element={<Home />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
          <FeestPaneel />
          <Toaster position="top-center" />
        </BevestigProvider>
      </TooltipProvider>
    </Vangnet>
  );
}
