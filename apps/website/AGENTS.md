# Website project guidance

Read the [workspace entry](../../AGENTS.md) and shared guides first. The stricter
common engineering, review, copy, dependency and testing requirements apply.
The owner-specific product/content/typography requirements below remain local.

- Use Svelte and Delightful UI as the foundation for the new site.
- Set up the basic site before content work. Do not add homepage content, filler copy, marketing text, project listings, or contact sections, or automatically copy old studio content forward. Defer positioning and content questions until the foundation is ready. Existing blog article preservation/migration remains in scope; keep test fixtures out of public content.
- The owner has authorized compact, interactive Clipper and Finance embeds on the homepage. Limit their content to app names and functional open-app links; other homepage editorial content remains deferred.
- The owner also authorized a rotating grayscale portrait using Paper Image Dithering and the four supplied photos, above the app embeds. Keep reduced-motion and static fallbacks.
- Typography belongs to Matt. Do not introduce fonts, typography scales, font sizes, weights, line heights, letter spacing, or typography overrides. Use existing Delightful UI defaults until Matt supplies typography work.
- Load published blog content from AT Protocol and render it natively. Do not embed Leaflet pages in iframes or substitute RSS-only integration for native record loading.
- The target hosting platform is Vercel.

## Spec Kit

The active feature is recorded in `.specify/feature.json`. Start with its `spec.md`.
Use the shared skills under `../../.agents/skills/speckit-*`. Set
`SPECIFY_INIT_DIR` to this app directory when invoking a helper from the workspace
root. Reusable templates and helpers are linked from this app’s `.specify/`. This setup reuses the Spec Kit 1.1.3
files already installed in the local Delightful Local First project. No project
constitution has been ratified; do not treat the constitution template as policy.

The website feature records under `specs/001-homepage-native-blog` retain current
implementation and verification status. The original foundation-phase next-step
text is retired; it does not restart completed work. Publication creation, archive
publishing, and production DNS cutover remain gated by the documented integration
checks. Content and typography remain deferred.
