# Implementation Plan: Native Blog Foundation

**Branch**: `002-site-foundation` | **Date**: 2026-11-09 | **Spec**: [spec.md](spec.md)

## Summary

Build the basic SvelteKit site and a configurable read-only Leaflet reader on AT
Protocol. Keep the homepage empty apart from functional navigation. No editorial
content, typography, account mutation, or production cutover.

## Technical Context

Svelte 5, SvelteKit 3, TypeScript, Vite, Node.js 24, pnpm; explicit Vercel adapter.
Server-render native articles with existing Delightful UI defaults. Registry
Delightful UI 0.0.24 still requires Svelte 4, so vendor a portable 0.0.25 artifact
built from clean source commit eaf1b98290944ef3a99c1fa183e227a61a8de2ee.
Default owner: did:plc:226m7t4kp7d7sg2qsdresypm. Publication stays unset until
Open Thoughts exists; never default to another author's records.

Reader lifecycle: exact `xstate@6.0.0-beta.1`, selected by the owner. Use the
installed v6 APIs and separate network/schema validation from the machine.
Zod 4.6.7 validates upstream envelopes before filtering publication membership.
The lifecycle contract and state diagram are in
[contracts/reader-lifecycle.md](contracts/reader-lifecycle.md).

## Constitution Check

No ratified constitution or extension hooks exist. Follow AGENTS.md: native
records, no Leaflet frames, no homepage content, no typography changes.

## Stages

1. Foundation: reproducible app, minimal shell, native record loader/renderer,
   isolated public-source proof, Vercel build output, behavior tests and docs.
2. Publication integration: owner-authenticated Leaflet setup, external canonical
   URL proof, editable migration proof, durable snapshot/cross-instance freshness.
3. Migration/cutover: six articles and assets, feeds, exact legacy redirect map,
   staged deployment checks, then production domains. Do not redirect to missing
   native articles or publish demonstration content.

The process-local five-minute cache in stage 1 is a replaceable proof mechanism,
not a durable production cache. Stages 2–3 remain explicit gates.

## Project Structure

src/lib/leaflet contains the validated read model and rich-text normalization;
src/lib/server/leaflet contains identity/PDS loading and configuration;
src/lib/components contains semantic Svelte renderers;
src/routes contains the shell, writing index, article, and verification routes;
tests contains isolated fixtures; vendor contains the pinned UI artifact.

## Validation

Svelte/TypeScript checks, behavior tests for public record loading, publication
filtering, pagination, rich text, gated/unknown content, cache failures/removals,
then a build and browser/direct-initial-HTML proof. No typography CSS assertions.

## Post-design Check

All owner constraints remain in force. Native loading is feasible by prior live
research. Hosted external canonical settings and publication mutation require
separate integration proofs and are not claimed by a foundation build.
