<script lang="ts">
  import { Heading } from "delightful-ui";
  import Blocks from "#lib/components/Blocks.svelte";
  import { pageAnchor } from "#lib/leaflet/content.ts";
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();
  const date = (value: string) =>
    new Intl.DateTimeFormat("en", {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(new Date(value));
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
    <Heading level="h1">{data.article.title}</Heading>
    <time datetime={data.article.publishedAt}
      >{date(data.article.publishedAt)}</time
    >
  </header>
  {#each data.article.pages as content (content.id)}
    <section id={pageAnchor(content.id)} aria-label={data.article.title}>
      <Blocks blocks={content.blocks} sourceUrl={data.article.sourceUrl} />
    </section>
  {/each}
  <a href={data.article.sourceUrl}>View on Leaflet</a>
</article>

<style>
  article,
  header {
    display: grid;
    gap: var(--dui-spacing-lg);
  }
</style>
