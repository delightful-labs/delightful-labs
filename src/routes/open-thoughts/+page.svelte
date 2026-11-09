<script lang="ts">
  import { Heading, Text } from "delightful-ui";
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();
  const date = (value: string) =>
    new Intl.DateTimeFormat("en", {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(new Date(value));
</script>

<svelte:head><title>Open Thoughts · Delightful Labs</title></svelte:head>
<div class="index">
  <Heading level="h1">Open Thoughts</Heading>
  {#if data.articles.length}
    <ul>
      {#each data.articles as article (article.uri)}
        <li>
          <a href={article.path}>{article.title}</a>
          <time datetime={article.publishedAt}>{date(article.publishedAt)}</time
          >
          {#if article.description}<Text>{article.description}</Text>{/if}
        </li>
      {/each}
    </ul>
  {:else}<Text>No published posts.</Text>{/if}
</div>

<style>
  .index,
  ul,
  li {
    display: grid;
    gap: var(--dui-spacing-md);
  }
  ul {
    padding: 0;
    list-style: none;
  }
</style>
