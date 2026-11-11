<script lang="ts">
  import "delightful-ui/theme-classic.css";
  import { Navigation } from "delightful-ui";
  import { page } from "$app/state";
  let { children } = $props();
</script>

<svelte:head>
  <title>Delightful Labs</title>
  <link rel="alternate" type="application/atom+xml" title="Open Thoughts" href="/open-thoughts/atom.xml" />
</svelte:head>
<div class="site">
  <a href="#main">Skip to content</a>
  <Navigation label="Main" orientation="horizontal">
    <li>
      <a href="/" aria-current={page.url.pathname === "/" ? "page" : undefined}
        >Home</a
      >
    </li>
    <li>
      <a
        href="/open-thoughts/"
        aria-current={page.url.pathname.startsWith("/open-thoughts/")
          ? "page"
          : undefined}>Open Thoughts</a
      >
    </li>
  </Navigation>
  <main id="main" tabindex="-1">{@render children()}</main>
</div>

<style>
  .site {
    max-inline-size: 72rem;
    margin-inline: auto;
    padding: var(--dui-spacing-lg);
    display: grid;
    gap: var(--dui-spacing-lg);
  }
  main {
    min-inline-size: 0;
  }
</style>
