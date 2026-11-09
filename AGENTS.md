# Repository working agreements

- Follow the active feature in `.specify/feature.json` and its artifacts under `specs/`. Follow `.specify/memory/constitution.md` if one is adopted.
- Before designing workflows or async actors, read `.specify/memory/xstate.md`. Before changing localized text, read `.specify/memory/localization.md`. Before styling or composing components, read `.specify/memory/css.md` and `.specify/memory/components.md`. These adapt shared lessons from Finance and DUI; domain-specific reference behavior is not an implicit library requirement.
- Machine changes use the pinned XState v6 beta and checked-in declaration patch. Follow the migration notes in `specs/003-verified-backup/xstate-v6-implementation.md`; retain generic contracts and the existing implementation-test review gate.
- This phase is specification-only. Do not implement the foundation, backend plugins, demonstration apps, or consumer migrations without a new instruction.
- Follow the Jazz-first MVP decisions in the active spec. Earlier Q1/Q2 decisions are resolved; the 2026-10-31 scope revision defers portable schemas and multi-backend qualification.
- Jazz is the only required v1 backend. Keep SDK access behind documented integration boundaries for later replacement; independent plugins and a second backend are deferred. Do not silently weaken app-required capabilities, permissions, or durability.
- Keep Finance and Clipper domain behavior outside the shared foundation. DUI owns generic presentation; this foundation owns identity/workspace compositions.
- Work on one task at a time and present it for review before beginning another. Change no more than one route or component per review cycle unless the user authorizes otherwise.
- Use functions, closures and plain data for application code. Do not introduce application-owned classes or inheritance; stateful lifecycles belong to XState machines.
- Do not use `switch` statements or `case` clauses in new application code; prefer narrowing, lookup records, or clear conditionals. Bundled Spec Kit scripts are inherited tooling.
- Do not add or run implementation tests before the user reviews and approves the implementation they cover.
- Use the repository Oxlint and Oxfmt configurations and avoid unrelated formatting.
- When starting a development server, tell the user and provide its URL.
- Never commit or publish without explicit authorization.
