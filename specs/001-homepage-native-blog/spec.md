# Feature Specification: Delightful Labs Homepage and Native Open Thoughts

**Feature Branch**: `001-homepage-native-blog`

**Created**: 2026-11-09

**Status**: Draft — initial technical research documented; owner-specific inputs and integration proofs remain

**Input**: Create a new Delightful Labs homepage and integrate Open Thoughts. Consolidate the landing-page and Eleventy blog repositories into the landing-page repository. Move publishing to Leaflet on AT Protocol, load records from AT Protocol, and render posts natively without embedding Leaflet pages in iframes. Use Svelte and Delightful UI. Move site hosting to Vercel. Typography is owned by Matt and must not be added or changed by this work. Set up the basic site first; do not add homepage content. Content work is deferred until afterward.

## Clarifications

### Session 2026-11-09

- Renderer decision: The owner accepts `@standard-reader/renderer-svelte@0.4.0` and matching core with their evaluated limitations. Replace the custom renderer; do not patch the package or rebuild its parser. Package support defines native content fidelity for this foundation. Overlapping/malformed facets, checklist state, member delimiters, unsupported blocks, and subpage/heading anchors follow package behavior. Keep no-iframe rendering, safe links, existing DUI defaults, and native AT Protocol loading. No existing Leaflet publication requires compatibility work yet. This decision supersedes the earlier custom-renderer preservation requirements below where they conflict; archive migration must still be verified before cutover.

- Q: Where should the blog's primary public address live? → A: Use `https://delightfullabs.com/open-thoughts/`, with individual native articles underneath it and permanent redirects from corresponding `thoughts.delightfullabs.com` URLs.
- Q: Is there an existing Leaflet publication, and which AT Protocol account should own it? → A: No existing Leaflet publication. The owner confirmed the corrected handle `@derocher.me`. Public resolution and the DID document reverse claim verified owner DID `did:plc:226m7t4kp7d7sg2qsdresypm` on 2026-11-09. No publication has been created.
- Scope clarification: Set up the basic site first. Do not add homepage content, make positioning decisions, or populate introduction, project, or contact sections. Content work will follow with the owner after setup. Existing article preservation/migration and rendering source records remain in scope; test fixtures must not become public content.
- Repository preparation: Remove the legacy landing-page code and assets in the same commit as this specification, then open a pull request. Retain the specification, research, Spec Kit tooling, and project guidance. Old files remain in Git history; the replacement application and production cutover are later work.
- Process instruction: Complete technical research before asking further owner questions. Researchable integration details are not owner preference questions.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Use the basic site and writing routes (Priority: P1)

A visitor can open the basic site shell and navigate to the native Open Thoughts
index. Homepage editorial content will be developed with the owner after the
foundation works.

**Why this priority**: Establish working routes and integration without making
content or positioning decisions on the owner's behalf.

**Independent Test**: Open the homepage shell and navigate to the writing index
using actual published records or clearly isolated test fixtures.

**Acceptance Scenarios**:

1. **Given** the basic site, **When** a visitor opens the homepage, **Then** it provides the structural shell and only necessary functional navigation, without invented introduction, marketing copy, project listings, contact sections, sample posts, or filler text.
2. **Given** published articles in the configured publication, **When** the visitor opens Open Thoughts, **Then** the index presents their source titles, original publication dates, available descriptions, and native article links, ordered newest first.
3. **Given** more articles than one upstream response page, **When** the visitor browses Open Thoughts, **Then** all public articles remain accessible without truncation.
4. **Given** a narrow viewport or keyboard-only interaction, **When** the visitor navigates the site, **Then** the same functional destinations remain available through semantic, accessible controls.

---

### User Story 2 - Read a Leaflet article natively (Priority: P1)

A reader opens an Open Thoughts article and reads its full supported content in
the Delightful Labs site, without leaving for Leaflet or signing in.

**Why this priority**: Native AT Protocol loading and article rendering are a
core requirement, beyond linking to or framing another site.

**Independent Test**: Load a real public Leaflet article from its AT Protocol
records and open its site URL directly. Verify the body, metadata, images, and
links against the published source.

**Acceptance Scenarios**:

1. **Given** a public article belonging to the configured publication, **When** its native URL is requested directly, **Then** the response contains its title, publication date, and readable article body within the site shell; no Leaflet page iframe is used.
2. **Given** an article containing paragraphs, headings, emphasis, links, ordered and unordered lists, quotations, code, and images, **When** it is displayed, **Then** supported content preserves its meaning, order, link targets, and supplied alternative text using semantic markup.
3. **Given** an unsupported block or interactive feature, **When** it is encountered, **Then** the rest of the article remains readable and package-supported blocks render and unsupported features may be omitted according to the accepted package constraints; the article retains its source link.
4. **Given** article metadata and a source publication URL, **When** a reader or crawler loads the article, **Then** the page has a title, description when available, a canonical URL consistent with the chosen canonical policy, and a link to its Leaflet source.
5. **Given** an unknown article or an article from another publication, **When** its identifier is requested, **Then** the site returns a not-found response rather than displaying unrelated content.

---

### User Story 3 - Publish once and see updates on the site (Priority: P1)

Matt writes and publishes in Leaflet. The site discovers new articles and edits
without requiring a second authoring or manual content-copying workflow.

**Why this priority**: Leaflet must become the publishing workflow while the
site remains a reliable native reader.

**Independent Test**: Publish, edit, and unpublish a test article in an explicitly
designated test publication and observe the corresponding site behavior.

**Acceptance Scenarios**:

1. **Given** a newly published public article, **When** the next successful refresh occurs, **Then** the article becomes available in the writing index within 15 minutes of upstream availability.
2. **Given** an edit to an existing article, **When** refreshed, **Then** the native page displays the updated content without changing its stable site URL.
3. **Given** a confirmed deletion or unpublication, **When** a complete successful reconciliation occurs, **Then** the article is removed from public listings and its native URL stops serving the removed body within 15 minutes of upstream availability.
4. **Given** a transient upstream failure, **When** a reader visits, **Then** the site can serve previously successful content for at most 24 hours after its last verification; it does not mistake a timeout or incomplete response for an empty publication or deletion.
5. **Given** no prior successful content and an upstream failure, **When** a visitor opens the homepage, **Then** the site shell and navigation remain usable and the writing route reports temporary unavailability. An uncached article request returns a retryable unavailable response rather than a false not-found response.

---

### User Story 4 - Follow an existing blog URL (Priority: P1)

A reader follows an old Open Thoughts article, image, archive, tag, or feed link
and reaches the intended content after migration.

**Why this priority**: Existing links and feed subscriptions must survive the
move away from the Eleventy site.

**Independent Test**: Run the complete legacy URL inventory against a staged
migration and compare each result with its recorded destination.

**Acceptance Scenarios**:

1. **Given** a migrated article, **When** its old public URL is requested, **Then** it either remains valid or permanently redirects to the corresponding article with no loop and at most one redirect.
2. **Given** a published archive article, **When** migration is reviewed, **Then** title, original date, body, images, and internal links have been checked against the original; unpublished exports have not been published accidentally.
3. **Given** a legacy feed subscription, **When** the old feed URL is fetched, **Then** it remains a valid feed or permanently redirects to the chosen valid replacement feed with correct article links.
4. **Given** old image, archive, and tag URLs, **When** requested, **Then** each has the preserved resource or the documented relevant destination; unrelated URLs are not all redirected to the homepage.

---

### User Story 5 - Maintain and release one site (Priority: P2)

A maintainer works from the Delightful Labs repository, reviews a preview,
and releases the combined site on Vercel.

**Why this priority**: Consolidation and hosting migration need a reproducible,
reviewable release path that preserves the current public sites until cutover.

**Independent Test**: From a clean checkout, follow the documented setup, build,
and preview procedure; verify representative routes and the redirect inventory.

**Acceptance Scenarios**:

1. **Given** a clean checkout, **When** the documented setup and build steps run, **Then** the combined site is buildable without the old blog repository being checked out alongside it.
2. **Given** a proposed change, **When** a preview is created, **Then** the homepage, writing index, direct article URLs, and migration behavior can be reviewed before production cutover.
3. **Given** a verified release, **When** hosting moves to Vercel, **Then** the intended production domains serve the correct site or redirects over HTTPS and a documented rollback procedure exists.
4. **Given** the old blog's content and assets, **When** consolidation completes, **Then** the landing-page repository retains the migration inputs, provenance, URL map, and operating instructions. Retiring the separate repository is a distinct owner decision.

### Edge Cases

- The publication has zero, one, or more articles than a single response can return.
- An author changes handle or PDS location; identity remains tied to a stable identifier.
- Multiple publications share an author; records must be filtered to the selected publication.
- Two articles have the same title, date, or slug; edits change titles or source paths.
- Current and legacy Leaflet record formats differ, or one logical article appears in both.
- Article pages are stored in blobs rather than inline; images require resolution from the author's PDS.
- An article has nested blocks, multiple pages, a canvas, an unknown block, or an unavailable image.
- Rich text contains unsafe URLs or markup. Native rendering must not execute author-provided scripts or unsafe HTML.
- Upstream services time out, rate limit, return malformed data, or return only part of an archive.
- A deleted article was previously cached; confirmed removal must take precedence over stale serving.
- A historical link includes a trailing slash, query string, or heading fragment; preserve meaningful anchors where possible and document unavoidable fragment changes.
- A Leaflet post is restricted or contains a members-only boundary; only public AT Protocol records are fetched. The package does not interpret member delimiters; this is an accepted publishing constraint, not an access-control mechanism.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The site MUST provide a minimal homepage shell and functional navigation to the Open Thoughts index. Homepage content, editorial sections, positioning, and project selection MUST be deferred until after basic setup; do not add filler or copy forward old marketing content automatically (Story 1).
- **FR-002**: The writing index MUST expose the complete public publication archive in reverse publication order, without duplicate logical articles or truncation to a single upstream page (Stories 1, 3).
- **FR-003**: Readers MUST be able to open full native article pages directly without authentication. Article content and metadata MUST be readable in the initial page response, without requiring a client-side fetch to reveal the body (Story 2).
- **FR-004**: The system MUST discover and load published content from public AT Protocol records, resolve the configured publication and author identity, and exclude drafts, other publications, and restricted content. Feed-only ingestion and scraping Leaflet HTML do not satisfy this requirement (Stories 2, 3).
- **FR-005**: Native rendering MUST use the accepted Standard Reader package support described in Story 2, with an article-level source link; a Leaflet-page iframe is prohibited (Story 2).
- **FR-006**: Article identity MUST remain stable across title edits and handle changes, and distinguish source record identity from a human-readable route. Alias behavior MUST prevent existing native links from breaking (Stories 2, 3).
- **FR-007**: New content, edits, and confirmed removals MUST meet the 15-minute refresh window. Cached availability MUST follow the 24-hour maximum and error/deletion distinctions in Story 3 (Story 3).
- **FR-008**: Article pages MUST expose accurate document metadata and source links, use their native `https://delightfullabs.com/open-thoughts/` addresses as canonical, and provide consistent sitemap and publication/document verification behavior where applicable. Leaflet-generated source/feed/social URLs must be reconciled with this policy before cutover; a second self-canonical source copy is not considered a completed integration (Story 2).
- **FR-009**: Content rendering MUST retain keyboard access and meaningful document structure, use supplied image alternative text, and reject unsafe markup and URL schemes. Missing alternative text MUST be flagged for content review rather than invented (Stories 1, 2).
- **FR-010**: Migration MUST inventory every currently published article and legacy public route, and record its preservation or permanent redirect. Source exports MUST be classified before import; unpublished content MUST remain unpublished (Story 4).
- **FR-011**: Migration MUST preserve article dates, content, assets, and relevant internal links, and provide a valid destination for existing feed subscribers (Story 4).
- **FR-012**: The landing-page repository MUST become the maintained home for the combined site, migration inputs, original content/assets, provenance, redirect map, and operating documentation. Live publication records remain in the author's PDS (Story 5).
- **FR-013**: The site MUST support the Vercel preview and production release path, direct article requests, HTTPS production domains, legacy redirects, and rollback. Production cutover MUST follow verification of the staged migration (Stories 4, 5).
- **FR-014**: Automated verification MUST cover native article reading, publication filtering, pagination, update/removal reconciliation, upstream failures, unsafe content, and every inventoried legacy route. Read-only checks MUST use public records; publication mutation tests MUST use an explicitly designated test publication (Stories 1–5).

### User-Mandated Constraints

These are explicit scope decisions from the owner, not implementation choices
introduced by this specification:

- Use **Svelte** and **Delightful UI** as the site foundation. Selection of application structure and rendering strategy belongs in the technical plan.
- Use **Leaflet** for publishing and **AT Protocol records** for native article loading. Do not use Leaflet pages in iframes. RSS/Atom/JSON feeds may support subscriptions or migration verification, but cannot replace native record loading.
- Move the site's hosting to **Vercel**. Maintaining Leaflet's own hosted application is outside this site's hosting migration.
- **Typography is Matt's responsibility.** Do not add fonts, type scales, font sizes, weights, line heights, letter spacing, or typography overrides. Use existing Delightful UI defaults pending owner-supplied typography. Semantic headings remain necessary; their visual treatment is owner-owned.
- Keep site and migration work in `delightful-labs/delightful-labs`, incorporating the needed material from `delightful-labs/open-thoughts`.

### Key Entities

- **Publication**: Selected Open Thoughts publication, stable owner identity, record identity, public source address, and visibility policy.
- **Article**: Stable source identity, publication association, title, description, original/updated dates, content pages/blocks, assets, source URL, native URL, and visibility state.
- **Legacy URL Mapping**: Old hostname/path, resource type, final destination, redirect/preservation decision, and verification result.
- **Migration Inventory**: Original source path, publication status, provenance, migrated record identity, and content/asset verification result.
- **Content Snapshot**: Last successfully verified public content, verification time, and reconciliation completeness; partial or failed retrieval cannot confirm deletion.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Visitors can reach the writing index from the homepage shell in one navigation action on mobile and desktop and using a keyboard, with no invented homepage editorial content.
- **SC-002**: Every migrated public article is readable at a direct native URL without sign-in, including its title, original date, and supported body content; review finds no silently omitted content.
- **SC-003**: New articles, edits, and confirmed removals are reflected within 15 minutes after becoming available from the publishing source during normal operation.
- **SC-004**: Every URL in the approved migration inventory resolves to its recorded destination, with no redirect loops and at most one redirect for moved articles.
- **SC-005**: Every migrated article passes a content comparison covering title, date, body, images, and internal links; no draft or unpublished export becomes public.
- **SC-006**: In an upstream-outage exercise, the site shell and navigation remain usable; cached articles remain readable within the agreed stale window, and uncached articles report temporary unavailability accurately.
- **SC-007**: A maintainer can reproduce the build and review a preview from a clean checkout using only the consolidated repository and documented configuration.
- **SC-008**: Review confirms zero typography additions or overrides introduced by this feature and zero embedded Leaflet page frames.
- **SC-009**: The writing index includes every eligible article in a test publication spanning multiple result pages, exactly once.

## Assumptions

- Open Thoughts remains the publication name. The initial homepage is a minimal structural shell with necessary functional navigation. Homepage sections, positioning, copy, project selection, and contact content are deferred to a later owner-led content phase. A three-article homepage section is not required for basic setup.
- The initial public experience is read-only. Comments, reactions, follows, subscriptions, and authoring can link to Leaflet; implementing those interactions natively is outside the initial release.
- The blog repository currently has six article Markdown files plus an image and earlier Write.as exports. The migration must verify the actual published inventory instead of assuming all repository files are public.
- **Owner decision (2026-11-09)**: The primary blog address is `https://delightfullabs.com/open-thoughts/`, with native article pages below it. Existing `thoughts.delightfullabs.com` article URLs will permanently redirect to their corresponding native pages. Leaflet remains the publishing tool; its source URLs and verification behavior must be reconciled with this canonical address during technical research.
- The 15-minute refresh target and 24-hour stale limit are proposed operating defaults, subject to validation in planning. No particular cache service or refresh mechanism is selected here.
- A new Open Thoughts Leaflet publication is needed. The confirmed account is `@derocher.me`, DID `did:plc:226m7t4kp7d7sg2qsdresypm`. Resolve the current PDS from its DID document rather than hard-coding a server. Content and typography work will follow with Matt after the basic site is set up; neither is a prerequisite to foundation work. Read-only site integration should not require publishing credentials.
- Repository access, Vercel project/team selection, and domain control are dependencies for later migration work. This specification does not initiate publication, deployment, DNS changes, or repository archival.

## Planning Research Required

Research findings are maintained in [research.md](research.md), with detailed
native-loading, migration, and hosting evidence linked there. Source inspection,
live public-record checks, and implementation proof gates are recorded separately.

The following are technical questions to resolve with current primary sources
and a small native-loading proof during the planning phase. They are not grounds
for replacing native loading with feeds or iframes.

1. **Identity and discovery**: Confirm the target account and publication; prove handle-to-DID and DID-to-PDS resolution, public record retrieval, publication filtering, complete pagination, and behavior after handle/PDS changes. Evaluate direct PDS access versus a documented public appview without relying on Leaflet's private database.
2. **Current content format**: Verify current `site.standard.document` and Leaflet content schemas against real published records. Establish whether legacy `pub.leaflet.document` compatibility is required; handle inline/blob pages, rich-text ranges, images, nested content, and duplicate representations. Produce a supported-block and fallback matrix from the actual archive and current editor output.
3. **Native-rendering proof**: Fetch and render at least one real article with text, links, and an image inside the proposed Svelte application. Document unsupported blocks, source provenance, visibility handling, and initial-response content. Do not change typography as part of the proof.
4. **Freshness and reliability**: Select a refresh/cache strategy that works across Vercel deployments and function instances, bounded stale serving, complete-scan deletion confirmation, rate limiting, and upstream failure handling. Verify the proposed freshness targets without assuming a Leaflet webhook exists.
5. **Canonical URLs and migration**: Decide which domain owns canonical articles, native versus Leaflet source URLs, publication/document verification, redirects, preserved heading anchors, feed continuity, and link rewrites. Confirm Leaflet's publication URL/path behavior before changing its records. Do not assume that changing a publication URL causes Leaflet to host or route the native site.
6. **Archive import**: Verify a supported way to migrate Eleventy/Markdown articles to Leaflet while preserving dates, images, visibility, and author editability. Publishing raw records alone must not be assumed to create editable Leaflet drafts. Prove one representative import before bulk migration and avoid sending archive notification emails inadvertently.
7. **Hosting cutover**: Inspect actual current hosting and DNS; select the Vercel project/team, Svelte deployment integration, domain assignments, preview checks, redirect placement, feed destination, cutover sequence, and rollback steps. Keep the old host operational until staged verification completes.

### Research Starting Points

These references are starting points, not a frozen API contract. Record exact
versions/commits and live evidence in the planning research artifact.

- [Landing-page source](https://github.com/delightful-labs/delightful-labs)
- [Open Thoughts source and migration inputs](https://github.com/delightful-labs/open-thoughts)
- [Delightful UI](https://github.com/delightful-labs/delightful-ui)
- [Leaflet source](https://github.com/hyperlink-academy/leaflet) and [manual](https://about.leaflet.pub/)
- [Standard.site definitions and verification](https://standard.site/)
- [AT Protocol specifications](https://atproto.com/specs/atp)
- [SvelteKit documentation](https://svelte.dev/docs/kit/introduction)
- [Vercel SvelteKit integration](https://vercel.com/docs/frameworks/full-stack/sveltekit)

## Out of Scope

- Typography design, font installation, type scales, or typography overrides.
- Leaflet page iframes, feed-only blog integration, or scraping article HTML.
- Rebuilding Leaflet's editor or social features, adding reader login, or bypassing restricted content.
- Adding homepage content, including draft/filler copy, introductions, marketing text, project listings, and contact sections; automatically carrying over old studio copy; or asking positioning/content questions before basic setup.
- Rewriting article prose or changing the brand identity.
- Migrating unrelated project repositories into this one.
- Self-hosting Leaflet, deleting the original blog repository, or making production changes during specification work.
