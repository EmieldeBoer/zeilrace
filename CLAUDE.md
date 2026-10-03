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

Zeilrace: live GPS-tracking voor een zeilrace (React + shadcn/ui + Convex, gehost op Vercel). Code, commentaar en
teksten zijn Nederlands. Zie README.md voor de opbouw.

- `bun run typecheck` controleert site en Convex; `bun run build` bouwt de site.
- Lokaal testen zonder account: `CONVEX_AGENT_MODE=anonymous bunx convex dev` en `bun run dev:frontend`,
  dan `bun scripts/simulatie.ts race` om boten te laten varen.
- De rekenregels in `src/lib/` (baan, verteller, piraat, polar) zijn een port van de oude vanilla-JS-site op `main`
  (bekijk de originele bestanden met `git show main:<bestand>.js`); houd het gedrag gelijk.
