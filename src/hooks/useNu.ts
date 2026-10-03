import { useEffect, useState } from "react";

// De huidige tijd, elke `ms` bijgewerkt (laat aftelklokken en 'x s geleden' meelopen)
export function useNu(ms = 1000): number {
  const [nu, setNu] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNu(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return nu;
}
