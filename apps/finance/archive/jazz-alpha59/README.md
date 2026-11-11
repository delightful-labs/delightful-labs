# Archived Jazz alpha.59 deployment and schema history

These files preserve Finance's original alpha.59 migrations, schema snapshots and Netlify/Jazz Cloud
preview tooling from commit `699e6d9525393b8300d32f95f4f3aeb622062477`.
They are historical reference, not inputs to the current application, type checks, unit tests or deployment.
The archived tests and scripts target the old SDK and directory layout; they are not runnable with the
current alpha.60 dependency installation. Use the original Git revision in an isolated checkout if
historical reproduction is needed. Do not execute this tooling against a live service.

Finance's alpha.60 deployment starts from a fresh schema and restores supported Finance backup archives.
The active schema is `src/lib/schema.ts`, with `migrations: 'none'` for that fresh target.
The real alpha.59 v1/v2 synthetic backup fixtures under `tests/fixtures/backup-compatibility` and their
active restore tests remain in place; they do not depend on this archived migration chain.
Future changes to the alpha.60 database require their own migration history from its actual schema baseline.

The retained Netlify deployment is a hosting rollback artifact. Archiving these files does not change the
published Netlify artifact, Vercel deployment, DNS or stored data. Do not rebuild the old deployment with
alpha.60 or treat this archive as a data rollback mechanism.
