# Data Model

- ReaderConfig: stable owner DID and optional standard publication AT URI. Publication owner must match the configured owner.
- Publication: AT URI, name, HTTPS source URL.
- Article: source AT URI, CID, record key, dates, title, description, native route,
  explicit Leaflet source URL, resolved PDS origin, and a StandardSiteDocument
  containing the author DID and hydrated Leaflet content pages. Route identity
  is independent of mutable titles.
- Content rendering: `@standard-reader/renderer-svelte@0.4.0` and matching core
  own the block/inline model. No application Page/Block/TextRun representation
  remains. Blob pages are loaded server-side before passing the document to the
  renderer. The owner accepts the package's published behavior and limitations.
- Snapshot: verified timestamp, publication and articles. Only
  complete successful scans replace it. Five minutes fresh, bounded stale on
  upstream failure for 24h. Process-local foundation store is not durable.
