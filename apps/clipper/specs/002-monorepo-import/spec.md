# Clipper workspace import

Follow the root monorepo migration spec. Import default-branch commit
`549e4b543bbca51b3a243fa7f88d4165f9f405f7` with original history. Keep the web and
extension sibling paths beneath `apps/clipper/apps/`: extension imports web
contracts/workers directly and both share coordinator tooling/test configuration.
These remain separately named packages with independent build/release settings.
Link the qualified UI and Local First source using peer-specific workspace copies.
Retain all product scope, private account ownership, worker boundaries, extension
identity, offline/recovery contracts and local policies. Do not change strings,
data, deployed destinations or hosted settings. Qualify source baseline, root
install, app types/unit tests, worker/browser/offline/extension artifacts and
source CI context. The user's migration authorization includes implementation
and tests in this session; future product review gates remain in effect.

See the root Clipper import record for qualification and remaining handoff work.
