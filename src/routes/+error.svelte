<script lang="ts">
  import { page } from "$app/state";
  import { Heading, Text } from "delightful-ui";
</script>

<svelte:head><title>{page.status} · Delightful Labs</title></svelte:head>
<Heading level="h1">{page.status}</Heading>
<Text>{page.error?.message || "Unable to load this page."}</Text>
