# Project guidance

- Use Svelte and Delightful UI as the foundation for the new site.
- Set up the basic site before content work. Do not add homepage content, filler copy, marketing text, project listings, or contact sections, or automatically copy old studio content forward. Defer positioning and content questions until the foundation is ready. Existing blog article preservation/migration remains in scope; keep test fixtures out of public content.
- Typography belongs to Matt. Do not introduce fonts, typography scales, font sizes, weights, line heights, letter spacing, or typography overrides. Use existing Delightful UI defaults until Matt supplies typography work.
- Load published blog content from AT Protocol and render it natively. Do not embed Leaflet pages in iframes or substitute RSS-only integration for native record loading.
- The target hosting platform is Vercel.
- Start development servers on `0.0.0.0` by default. Announce localhost and LAN URLs when available. Use distinct available ports; do not stop unidentified servers.

## Spec Kit

The active feature is recorded in `.specify/feature.json`. Start with its `spec.md`.
Spec Kit commands are available under `.agents/skills/speckit-*`; reusable templates
and shell helpers are under `.specify/`. This setup reuses the Spec Kit 1.1.3
files already installed in the local Delightful Local First project. No project
constitution has been ratified; do not treat the constitution template as policy.

The current deliverable is the specification and removal of the legacy landing
page implementation in the same commit. The old files remain available in Git
history. New application implementation, publishing migrated articles, and
production hosting/DNS cutover are later work.
