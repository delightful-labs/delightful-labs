<script>
  import { StandardDocument } from '@standard-reader/renderer-svelte';
  let { document, options } = $props();
</script>
<StandardDocument {document} {options} />
