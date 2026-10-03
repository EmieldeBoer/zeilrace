<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Project

Zeilrace: live GPS-tracking en wedstrijden voor groepen zeilboten (React + shadcn/ui + Convex, gehost op Vercel).
Code, commentaar en teksten zijn Nederlands. Zie README.md voor de opbouw, de rollen en de beveiliging.

- Alles hoort bij een groep. Elke Convex-functie die groepsdata leest of schrijft, neemt `{ groep, token }` en controleert
  toegang met `toegang`, `eisLid`, `eisHost` of `eisClaim` uit `convex/lib/db.ts`. Queries geven `null` zonder toegang.
- De boten zijn per groep. `BOTEN` en `FLEET` in `convex/lib/config.ts` zijn een register dat `useRace` vult
  (`zetVloot`); oude uitslagen rekenen met hun eigen momentopname (`metVloot`, `vlootVan`).
- De piratenmodus (`groep.piraat`) staat standaard uit. Zonder piratenmodus: geen piratentaal, geen zeeslag, geen kompas.
- `bun run typecheck` controleert site en Convex; `bun run build` bouwt de site.
- Lokaal testen zonder account: `CONVEX_AGENT_MODE=anonymous bunx convex dev` en `bun run dev:frontend`,
  dan `bun scripts/simulatie.ts groep`, `baan` en `race 1,2,3` om boten te laten varen.
- De rekenregels in `src/lib/` (baan, verteller, piraat, polar) zijn een port van de oude vanilla-JS-site op `main`
  (bekijk de originele bestanden met `git show main:<bestand>.js`); houd het gedrag gelijk.
