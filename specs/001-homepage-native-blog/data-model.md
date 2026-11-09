# Data Model

- ReaderConfig: stable owner DID, optional standard publication AT URI, HTTPS
  canonical origin. Publication owner must match the configured owner.
- Publication: AT URI, name, HTTPS source URL.
- Article: source AT URI, CID, record key, dates, title, description, native route,
  explicit Leaflet source URL, normalized ordered pages. Route identity is
  independent of mutable titles.
- Page/Block: validated semantic content; unknown blocks retain a source fallback.
  Traverse only root-reachable subpages, bound recursion, respect member delimiter.
- TextRun: escaped text, semantic marks, safe optional URL/anchor. Source ranges
  are UTF-8 byte offsets, not JavaScript string offsets.
- Snapshot: config identity, verified timestamp, publication and articles. Only
  complete successful scans replace it. Five minutes fresh, bounded stale on
  upstream failure for 24h. Process-local foundation store is not durable.
