<script lang="ts">
  import { Heading } from "delightful-ui";
  import LeafletDocument from "#lib/components/LeafletDocument.svelte";
  import { formatDate } from "#lib/date.ts";
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>{data.article.title} · Open Thoughts</title>
  {#if data.article.description}<meta
      name="description"
      content={data.article.description}
    />{/if}
  <link rel="canonical" href={data.canonical} />
  <link rel="site.standard.document" href={data.article.uri} />
</svelte:head>
<article>
  <header>
    <Heading level="h1" id={data.legacyTitleId}>{data.article.title}</Heading>
    <time datetime={data.article.publishedAt}
      >{formatDate(data.article.publishedAt)}</time
    >
  </header>
  <LeafletDocument
    document={data.article.document}
    pds={data.article.pds}
    sourceUrl={data.article.sourceUrl}
  />
  <a href={data.article.sourceUrl}>View on Leaflet</a>
</article>

<style>
  article,
  header {
    display: grid;
    gap: var(--dui-spacing-lg);
  }
</style>
