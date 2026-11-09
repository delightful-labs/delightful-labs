# Foundation Validation

Use Node.js 24 and the pinned pnpm version. Run pnpm install --frozen-lockfile,
pnpm check, pnpm test and pnpm build, then pnpm dev (binds 0.0.0.0).

Without a publication, the homepage has navigation only; the writing index has
no sample articles. Use .env.example for later publication configuration.
A temporary public-source proof must override BOTH author DID and publication
in an isolated local process; never set demonstration content in production.
Verify a direct article's initial HTML and browser rendering, including image,
links and absence of frames/console failures. Record evidence in verification.md.

The Vercel adapter produces .vercel/output. Link the correct project/team before
vercel env pull .env.local. A local build is not a hosted deployment. Keep DNS,
publication mutation, durable snapshots, feed/redirect and archive checks gated.
