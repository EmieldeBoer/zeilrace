import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";

// De wedstrijdleiding: na inloggen bewaart de browser een sessietoken.
// De server controleert dat token bij elke actie van de wedstrijdleiding.
const SLEUTEL = "zeilrace-wl-token";
const lees = () => { try { return localStorage.getItem(SLEUTEL); } catch { return null; } };
const schrijf = (t: string | null) => {
  try { if (t) localStorage.setItem(SLEUTEL, t); else localStorage.removeItem(SLEUTEL); } catch { /* privémodus */ }
};

export function useWl() {
  const [token, setToken] = useState<string | null>(lees);
  const sessie = useQuery(api.wl.sessie, token ? { token } : "skip");
  const loginMut = useMutation(api.wl.login);
  const uitMut = useMutation(api.wl.uitloggen);

  // Onbekend of verlopen token: vergeten
  useEffect(() => {
    if (token && (sessie === null || (sessie && sessie.verloopt < Date.now()))) { schrijf(null); setToken(null); }
  }, [token, sessie]);

  const login = useCallback(async (wachtwoord: string) => {
    const r = await loginMut({ wachtwoord });
    if (!r.ok) throw new Error(r.reden);
    schrijf(r.token); setToken(r.token);
  }, [loginMut]);
  const logout = useCallback(async () => {
    const t = token;
    schrijf(null); setToken(null);
    if (t) await uitMut({ token: t }).catch(() => {});
  }, [token, uitMut]);

  return { token: token ?? "", isWl: !!token && !!sessie && sessie.verloopt > Date.now(), laden: !!token && sessie === undefined, login, logout };
}
export type Wl = ReturnType<typeof useWl>;
