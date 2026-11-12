# Archived alpha.59 deployment tooling

Historical deployment tooling remains here as reference material, outside active
application checks and deployment commands. Historical schema migrations and snapshots
have been removed; Git history retains them if needed for research.

The application uses its current schema with `migrations: 'none'` and disposable
development databases. The saved-content `snapshots` table is application data, not a
schema snapshot, and remains part of content storage.
