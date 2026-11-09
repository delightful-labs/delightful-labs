<script lang="ts">
  import {
    StandardDocument,
    type SvelteSharedComponents,
  } from "@standard-reader/renderer-svelte";
  import type {
    StandardSiteDocument,
    RendererOptions,
  } from "@standard-reader/renderer-core";
  import { Heading, Text } from "delightful-ui";
  import { safeLink } from "#lib/leaflet/links.ts";
  import { object, string } from "#lib/leaflet/values.ts";

  let {
    document,
    pds,
    sourceUrl,
    unstyled = false,
  }: {
    document: StandardSiteDocument;
    pds: string;
    sourceUrl: string;
    unstyled?: boolean;
  } = $props();
  type Props<K extends keyof SvelteSharedComponents> = Parameters<
    NonNullable<SvelteSharedComponents[K]>
  >[0];
  const options = $derived<RendererOptions>({
    resolveImageUrl: ({ blob, authorDid }) => {
      const value = object(blob),
        cid = string(object(value.ref).$link);
      if (
        !authorDid ||
        !/^b[a-z2-7]{10,}$/.test(cid) ||
        ![
          "image/png",
          "image/jpeg",
          "image/webp",
          "image/avif",
          "image/gif",
        ].includes(string(value.mimeType))
      )
        return null;
      const url = new URL("/xrpc/com.atproto.sync.getBlob", pds);
      url.searchParams.set("did", authorDid);
      url.searchParams.set("cid", cid);
      return url.href;
    },
  });
</script>

{#snippet paragraph({ children }: Props<"paragraph">)}
  <Text>{@render children()}</Text>
{/snippet}
{#snippet heading({ level, children }: Props<"heading">)}
  <Heading
    level={`h${Math.min(6, Math.max(1, Math.floor(level)))}` as
      "h1" | "h2" | "h3" | "h4" | "h5" | "h6"}>{@render children()}</Heading
  >
{/snippet}
{#snippet link({ href, children }: Props<"link">)}
  {@const url = safeLink(href)}
  {#if url}<a href={url}>{@render children()}</a
    >{:else}{@render children()}{/if}
{/snippet}
{#snippet website({ src, title }: Props<"website">)}
  {@const url = safeLink(src)}
  {#if url}<a href={url}>{title || url}</a>{/if}
{/snippet}
{#snippet button({ href, text }: Props<"button">)}
  {@const url = safeLink(href)}
  {#if url}<a href={url}>{text}</a>{:else}{text}{/if}
{/snippet}
{#snippet sourceFallback()}<a href={sourceUrl}>View this content on Leaflet</a
  >{/snippet}

<StandardDocument
  {document}
  {options}
  components={{
    shared: {
      paragraph: unstyled ? undefined : paragraph,
      heading: unstyled ? undefined : heading,
      link,
      website,
      button,
      iframe: sourceFallback,
      blueskyEmbed: sourceFallback,
    },
  }}
/>
