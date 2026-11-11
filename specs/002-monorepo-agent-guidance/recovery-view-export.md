# Recovery view package compatibility

The user authorized implementation and tests of the remaining compatibility work
without another implementation-review pause for this migration session.

Clipper's existing `delightful-local-first@0.0.0` presentation patch adds the
`./recovery/view` public export and fixes a declaration collision between the
component's default name and its imported view-model type. Both are now in
library source: the view-model import is aliased and the export points to the
packaged component/declaration. No component markup, styling, messages or runtime
behavior changed. Existing consumer patches are not removed yet.

The public package-consumer fixture now imports this exact subpath through a
Svelte-aware bundler. Library checks, strict package/publint, all packaged-consumer
checks/builds, public Storybook build and all 63 Storybook Chromium tests passed.
This replaces the two original patch hunks once Clipper is linked to the source
package; applying that old package patch to the workspace source is unnecessary.
SDK runtime patches remain a separate reconciliation step.

Rollback this slice restores the prior source import name, export metadata and
consumer fixture. No app dependency, stored data or deployed artifact changed.
