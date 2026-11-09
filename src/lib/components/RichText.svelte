<script lang="ts">
  import type { TextRun } from "#lib/leaflet/content.ts";
  let { runs }: { runs: TextRun[] } = $props();
</script>

{#each runs as run}
  {#snippet marks()}
    {#snippet underline()}{#if run.underline}<u>{run.text}</u
        >{:else}{run.text}{/if}{/snippet}
    {#snippet strike()}{#if run.strike}<s>{@render underline()}</s
        >{:else}{@render underline()}{/if}{/snippet}
    {#snippet code()}{#if run.code}<code>{@render strike()}</code
        >{:else}{@render strike()}{/if}{/snippet}
    {#snippet italic()}{#if run.italic}<em>{@render code()}</em
        >{:else}{@render code()}{/if}{/snippet}
    {#if run.bold}<strong>{@render italic()}</strong
      >{:else}{@render italic()}{/if}
  {/snippet}
  {#if run.href}<a href={run.href} id={run.id}>{@render marks()}</a>
  {:else if run.id}<span id={run.id}>{@render marks()}</span>
  {:else}{@render marks()}{/if}
{/each}
