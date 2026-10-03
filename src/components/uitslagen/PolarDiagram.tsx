// ---- Polardiagram (SVG): halve cirkel, wind van boven ----
import { Fragment } from "react";
import { MIN_METINGEN, kleurVan } from "@/lib/polar";
import type { PolarBoot } from "@/lib/polar";

const rad = Math.PI / 180;

export function PolarDiagram({ polar, schaalKn }: { polar: PolarBoot; schaalKn: number }) {
  const W = 300, H = 300, cx = 40, cy = 150, R = 130;
  const max = Math.max(2, Math.ceil((schaalKn || 1) / 2) * 2);
  const xy = (twa: number, kn: number): [number, number] => [cx + Math.sin(twa * rad) * kn / max * R, cy - Math.cos(twa * rad) * kn / max * R];
  const ringen: number[] = [];
  for (let k = 2; k <= max; k += 2) ringen.push(k);                       // snelheidsringen
  const hoeken: number[] = [];
  for (let a = 0; a <= 180; a += 30) hoeken.push(a);                      // windhoeken
  const krachten = Object.entries(polar.vakken).sort((a, b) => Number(a[0]) - Number(b[0]));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="polar-svg w-full h-auto block" role="img" aria-label="Polardiagram">
      {ringen.map((k) => {
        const r = k / max * R;
        return (
          <Fragment key={`r${k}`}>
            <path d={`M${cx} ${cy - r} A${r} ${r} 0 0 1 ${cx} ${cy + r}`} fill="none" stroke="#8a6a3a" strokeWidth=".6" opacity=".6" />
            <text x={cx - 4} y={cy - r + 4} textAnchor="end" className="polar-as">{k}</text>
          </Fragment>
        );
      })}
      {hoeken.map((a) => {
        const [x, y] = xy(a, max);
        return (
          <Fragment key={`h${a}`}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke="#8a6a3a" strokeWidth=".5" opacity=".5" />
            <text x={cx + Math.sin(a * rad) * (R + 12)} y={cy - Math.cos(a * rad) * (R + 12) + 4} textAnchor="middle" className="polar-as">{`${a}°`}</text>
          </Fragment>
        );
      })}
      <text x={cx + 16} y={10} textAnchor="start" className="polar-as">← wind van boven</text>
      {krachten.map(([kracht, perVak]) => {
        const kleur = kleurVan(kracht);
        const punten = Object.values(perVak).sort((a, b) => a.twa - b.twa);
        const goed = punten.filter((x) => x.n >= MIN_METINGEN);
        return (
          <Fragment key={`k${kracht}`}>
            {goed.length > 1 && (
              <polyline fill="none" stroke={kleur} strokeWidth="2.2" points={goed.map((x) => xy(x.twa, x.kn).join(",")).join(" ")} />
            )}
            {punten.map((x) => {
              const [px, py] = xy(x.twa, x.kn);
              return (
                <circle key={x.twa} cx={px} cy={py} r={x.n >= MIN_METINGEN ? 3.2 : 2} fill={kleur} opacity={x.n >= MIN_METINGEN ? 1 : .35}>
                  <title>{`${kracht} Bft · ${Math.round(x.twa)}° · ${x.kn.toFixed(1)} kn (${x.n} metingen)`}</title>
                </circle>
              );
            })}
          </Fragment>
        );
      })}
    </svg>
  );
}
