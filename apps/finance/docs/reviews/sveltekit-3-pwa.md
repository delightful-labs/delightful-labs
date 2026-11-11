# PWA options for SvelteKit 3

Researched 2026-10-12. The user selected the native SvelteKit service-worker approach, with Workbox deferred. Implementation now targets SvelteKit 3.0.1 with a standalone web app manifest, precached generic prerendered pages/build assets, and the standard waiting worker lifecycle. The findings below record the alternatives considered.

## Conclusion

SvelteKit 3 has native service-worker support. PWA support is available independently of the older framework plugin's declared compatibility range. The plugin mismatch should not hold up a SvelteKit upgrade by itself. Jazz integration remains a separate compatibility check.

## Available approaches

| Approach                                   | Current position                                       | Tradeoff                                                                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SvelteKit's native service-worker pipeline | Documented for Kit 3                                   | Uses the framework's build/registration support; application-specific caching policy remains ours.                                                             |
| Native pipeline with Workbox modules       | Established building blocks                            | Delegate precaching/routing to Workbox while retaining explicit control over the cached shell and data boundaries. Integration must be validated in our build. |
| `@katama-labs/vite-pwa-sveltekit` 2.0.0    | Published fork targeting Kit 3, Vite 8, Node 22.17+    | Closest replacement for the existing plugin; temporary third-party fork whose build approach has maintainer reservations.                                      |
| `@vite-pwa/sveltekit` 1.1.0                | Latest official release declares Kit 1/2 compatibility | Not an established Kit 3 solution.                                                                                                                             |
| Future `@unplugin-pwa/sveltekit`           | No npm release found                                   | Maintainer describes the new integration as upcoming; do not treat it as available.                                                                            |

## Evidence

- [SvelteKit service-worker documentation](https://svelte.dev/docs/kit/service-workers): `src/service-worker/index.ts` is bundled and registered by the framework. Kit 3 offers typed worker context through `$app/service-worker`, build metadata through `$app/manifest`, and deployment version information through `$app/env`. Service-worker code gets a separate TypeScript configuration. Production builds are needed to validate the actual worker.
- [Kit 3 migration guide](https://svelte.dev/docs/kit/migrating-to-sveltekit-3): old `$service-worker` imports are removed, and service workers are registered as modules.
- [Workbox precaching](https://developer.chrome.com/docs/workbox/modules/workbox-precaching): Workbox handles asset revisions, precache routing, and cleanup. This is an option to avoid implementing those mechanisms ourselves.
- [Plugin support proposal](https://github.com/vite-pwa/sveltekit/pull/111): closed without merge on 2026-10-09. The author reports that 1.1.0 can complete a Kit 3 build without producing a service worker because the build lifecycle changed. We did not independently reproduce that result.
- [Maintainer response](https://github.com/vite-pwa/sveltekit/pull/111#issuecomment-6083757222): the proposed worker build needs more work; the maintainer is preparing a different integration approach.
- [Fork announcement](https://github.com/vite-pwa/sveltekit/pull/111#issuecomment-6083987414): the author published the change as a temporary replacement and says its configuration options remain unchanged. npm metadata confirms version 2.0.0 and a Kit 3 peer range. This is not official upstream support or verification in Delightful Finance.
- [PWA installation requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable): installation and offline operation are distinct concerns. A web app manifest, icons, and HTTPS belong in the installation setup; offline startup also needs a cached executable shell.

## Recommendation for Delightful Finance

### Implementation verification

Following user review, the dedicated production Playwright suite passed all three checks on 2026-10-12: offline direct navigation and reload to an unvisited expense form with a persisted account; same-origin public shell/asset cache boundaries; and a worker update waiting while an unsaved account form remains unchanged. Run it with `pnpm test:pwa` after building with valid public database settings. The local verification build used the running development database rather than an empty server URL. Browser installation prompts, multi-tab activation, and production hosting remain to be reviewed separately.

Use SvelteKit 3's native worker pipeline, adding Workbox where it meaningfully replaces custom cache logic. Preserve the web app manifest and installation assets when removing the old plugin. Do not bypass the old plugin's peer range and assume a successful build establishes an offline app.

The service worker should cache the application shell, route chunks, styles, fonts, and icons. Jazz remains responsible for financial data persistence and synchronization. Keep authentication, secrets, and synchronization traffic outside the worker's runtime caching policy.

Choose how an offline document navigation loads the shell: prerendered application pages or a suitable generic fallback. Merely caching JavaScript does not make a fresh offline launch at `/expenses` work. This is a routing/build decision to resolve during migration, not a requirement to replace the current adapter immediately.

Use an update prompt rather than automatically reloading an active form. After the implementation is reviewed, validate a production build for installation, worker registration, offline reload/deep links, route chunks, Jazz data availability, and updates. Follow the existing agreement to add/run tests only after code review. No packages were installed, tests run, or servers started for this research.
