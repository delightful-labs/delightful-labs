# Leaflet external canonical URL proof

Rechecked November 9, 2026. Status: source research and public identity checks
complete; authenticated hosted workflow remains unproved. No publication,
article, domain, DNS, or email changes were made.

## Current publication

Public DID resolution, the PDS publication record, and Leaflet's verification
endpoint agree:

- Owner: `did:plc:226m7t4kp7d7sg2qsdresypm` (`@derocher.me`).
- URI: `at://did:plc:226m7t4kp7d7sg2qsdresypm/site.standard.publication/3mzv6a2yk522y`.
- Publication CID: `bafyreiarjpoqcki4wnft2tv75jjljbjcyc4utn66dnslu23nqaxlbs3k5a`.
- Name: Open Thoughts.
- Current record URL: `https://open-thoughts.leaflet.pub`.
- Desired record URL, after proof: `https://delightfullabs.com/open-thoughts`.
- Current PDS: `https://morel.us-east.host.bsky.network`; keep resolving it from
  the DID document rather than treating this observation as configuration.
- Complete document enumeration: zero records belonging to this publication,
  one response page with no continuation cursor. There is no post to use as a
  hosted editing proof yet.

Public verification source:
https://open-thoughts.leaflet.pub/.well-known/site.standard.publication

## What the inspected implementation establishes

GitHub `main` still resolves to Leaflet commit
`600c7b5f1f7b31b66fb626c293cc104312a12caf`, the same revision used in the initial
research. This does not identify the revision deployed at leaflet.pub.

1. [PubDomainSettings.tsx](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/app/%28app%29/%28identity%29/lish/%5Bdid%5D/%5Bpublication%5D/dashboard/settings/PubDomainSettings.tsx)
   lists assigned publication domains, and “Set as Default” supplies that domain
   to `updatePublicationBasePath`. The inspected UI has no arbitrary external
   publication-URL/subpath input. Assigning a hostname is a hosting operation;
   it does not attach just a path to our Svelte site.
2. [updatePublication.ts](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/actions/publications/updatePublication.ts)
   derives `existingBasePath` from the publication URL in Leaflet's database,
   then writes rebuilt records to both the PDS and that database. Ordinary
   name/settings updates reuse that value. This supports persistence in the
   inspected code once both representations agree; it does not prove a supported
   hosted way to configure it. A direct PDS-only edit could leave Leaflet's stored
   record inconsistent and a later settings save could overwrite it.
3. [buildPublicationRecord.ts](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/src/utils/buildPublicationRecord.ts)
   creates the Standard.site URL by prefixing `https://` to the chosen base path.
   The desired external subpath is representable in this implementation.
4. [publishLeaflet.ts](https://github.com/hyperlink-academy/leaflet/blob/600c7b5f1f7b31b66fb626c293cc104312a12caf/src/utils/publishLeaflet.ts)
   emits a document path of `/<rkey>`. An actual migrated record key or native
   alias must agree with the preserved slug before old links redirect to it.
5. [Standard.site verification](https://standard.site/docs/verification) supports
   subpath publications. Our required publication endpoint remains
   `https://delightfullabs.com/.well-known/site.standard.publication/open-thoughts`.
   Serving the endpoint in Preview proves our handler, not control of the final
   production hostname or successful Leaflet authoring.

The [Leaflet manual](https://about.leaflet.pub/) documents custom domains and
provides a support contact. It does not document the external-subpath workflow
needed here. Browser tooling could not connect to an authenticated Chrome session
in this environment, so no claim is made about the current account UI.

## Prepared hosted proof

Use a designated test publication and an owner-approved existing article or
explicitly approved test content. Do not publish placeholders to Open Thoughts
just to make this checklist pass.

- [ ] Establish a supported Leaflet procedure for setting an externally hosted
  publication URL with a path, without registering the native hostname for
  Leaflet hosting. If the inspected UI reflects the hosted product, staff support
  may be required. Do not invoke undocumented Next.js actions as an API.
- [ ] Configure the test publication through that supported procedure and verify
  agreement between Leaflet's displayed settings and the public PDS record.
- [ ] Quiet-publish a representative editable draft with the intended date and
  image. Verify the resulting document URI/path, source-view route, native HTML,
  image, and document link tag.
- [ ] Edit and republish the same draft; verify stable record identity, updated
  body, retained date, and retained external publication URL.
- [ ] Reload and save ordinary non-typographic publication settings. Re-read the
  PDS record and verify the external URL survives. Do not edit typography for
  this proof.
- [ ] Check source canonical/open-graph URLs and source, preview, follow,
  subscription, comment, and advertised feed links. Record any supported
  limitations explicitly; our native feed destinations must exist before cutover.
- [ ] Verify the final-origin publication endpoint and article document references
  as part of approved hosting cutover. Do not claim final-origin verification from
  a Preview URL.

T014 remains open until the authenticated publication/edit/settings checks pass.
T016's archive preservation can proceed independently, but import/publication,
redirect activation, and T017 production cutover remain gated.

## Unsent support request

Prepared for owner review; this has not been sent:

> We use Leaflet as the editor for Open Thoughts under @derocher.me, while a
> SvelteKit frontend reads the public AT Protocol records and renders them
> natively. We want the publication URL to be
> https://delightfullabs.com/open-thoughts, on our own Vercel project, while
> retaining https://open-thoughts.leaflet.pub as a source view. Is there a supported
> way to configure that external URL, including the path, without assigning
> delightfullabs.com to Leaflet's hosting? We need it to survive editing and
> republishing posts and saving publication settings. If this requires staff
> configuration, can you confirm how both Leaflet's stored publication and the
> PDS record should stay aligned? We have not changed the record or DNS.
