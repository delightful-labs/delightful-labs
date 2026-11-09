<script lang="ts">
  import { Heading, Text } from "delightful-ui";
  import { pageAnchor, type Block } from "#lib/leaflet/content.ts";
  import RichText from "./RichText.svelte";
  let { blocks, sourceUrl }: { blocks: Block[]; sourceUrl: string } = $props();
  let brokenImages = $state<string[]>([]);
</script>

{#snippet renderBlocks(values: Block[])}
  {#each values as block}
    {#if block.kind === "text"}
      <Text><RichText runs={block.runs} /></Text>
    {:else if block.kind === "heading"}
      <Heading
        level={`h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6"}
        id={block.id}><RichText runs={block.runs} /></Heading
      >
    {:else if block.kind === "quote"}
      <blockquote><RichText runs={block.runs} /></blockquote>
    {:else if block.kind === "code"}
      <pre><code>{block.text}</code></pre>
    {:else if block.kind === "rule"}<hr />
    {:else if block.kind === "image"}
      {#if brokenImages.includes(block.src)}
        <p><a href={sourceUrl}>View image on Leaflet</a></p>
      {:else}
        <img
          src={block.src}
          alt={block.alt}
          loading="lazy"
          onerror={() => {
            brokenImages = [...brokenImages, block.src];
          }}
        />
      {/if}
    {:else if block.kind === "list"}
      {#snippet items()}
        {#each block.items as item}
          <li>
            {#if item.checked !== undefined}<input
                type="checkbox"
                checked={item.checked}
                disabled
                aria-label={item.checked ? "Completed" : "Not completed"}
              />{/if}
            {@render renderBlocks(item.blocks)}
          </li>
        {/each}
      {/snippet}
      {#if block.ordered}<ol start={block.start}>
          {@render items()}
        </ol>{:else}<ul>{@render items()}</ul>{/if}
    {:else if block.kind === "link"}<p><a href={block.href}>{block.text}</a></p>
    {:else if block.kind === "page"}<p>
        <a href={`#${pageAnchor(block.id)}`}>Open page</a>
      </p>
    {:else}<p><a href={sourceUrl}>View this content on Leaflet</a></p>{/if}
  {/each}
{/snippet}

<div class="blocks">{@render renderBlocks(blocks)}</div>

<style>
  .blocks {
    display: grid;
    gap: var(--dui-spacing-md);
  }
  img {
    max-inline-size: 100%;
    block-size: auto;
  }
  pre {
    overflow-x: auto;
    max-inline-size: 100%;
  }
</style>
