import { Component, lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { BevestigProvider } from "@/components/Bevestig";
import { FeestPaneel } from "@/components/FeestPaneel";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { foutTekst } from "@/lib/fouten";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Tracker = lazy(() => import("./pages/Tracker"));

// Gaat er iets mis bij het laden (geen verbinding, server weg), dan een nette melding
class Vangnet extends Component<{ children: ReactNode }, { fout: unknown }> {
  state = { fout: null as unknown };
  static getDerivedStateFromError(fout: unknown) { return { fout }; }
  render() {
    if (!this.state.fout) return this.props.children;
    return (
      <div className="p-6 text-ivoor">
        <h1 className="titel-goud text-3xl">☠ Er ging iets mis</h1>
        <p className="mt-3">{foutTekst(this.state.fout)}</p>
        <button className="mt-4 underline" onClick={() => location.reload()}>Opnieuw laden</button>
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
            <Suspense fallback={<div className="p-6 text-ivoor-zacht italic">Laden…</div>}>
              <Routes>
                <Route path="/tracker" element={<Tracker />} />
                <Route path="/tracker.html" element={<Tracker />} />
                <Route path="*" element={<Dashboard />} />
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
