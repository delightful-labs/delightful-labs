# Delightful UI source artifact

`delightful-ui-0.0.25.tgz` was built with `pnpm run package` and `pnpm pack`
from the clean Delightful UI checkout at commit
`eaf1b98290944ef3a99c1fa183e227a61a8de2ee` on 2026-11-09.

- Source: https://github.com/delightful-labs/delightful-ui/tree/eaf1b98290944ef3a99c1fa183e227a61a8de2ee
- SHA-256: `101ba149fe7fe93a4e20b3419420e77356ce50653dfdb9c2514484a295b44f73`
- Package: `delightful-ui` 0.0.25, Svelte peer `^5.57.2`.
- The npm registry's current 0.0.24 package still targets Svelte 4. This portable
  archive avoids an incompatible install or a dependency on a sibling checkout.
- No library source or typography was changed. No npm package was published.

When a compatible release is published, replace the file dependency with the
verified release and remove this archive in that same dependency update.
