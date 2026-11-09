<script>
  import { StandardDocument } from '@standard-reader/renderer-svelte';
  let { document } = $props();
  function safe(href) {
    try { return ['https:', 'http:', 'mailto:'].includes(new URL(href).protocol); }
    catch { return href.startsWith('#'); }
  }
</script>
{#snippet link({ href, children })}
  {#if safe(href)}<a {href}>{@render children()}</a>{:else}{@render children()}{/if}
{/snippet}
{#snippet fallback()}<a href="https://leaflet.pub/">View this content on Leaflet</a>{/snippet}
<StandardDocument {document} components={{ shared: { link, iframe: fallback, unknown: fallback } }} />
