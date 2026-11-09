<script lang="ts">
  import Portraits from "#lib/components/Portraits.svelte";
  import { Heading } from "delightful-ui";

  const apps = [
    {
      id: "clipper",
      name: "Clipper",
      url: "https://clipper.delightfullabs.com/",
    },
    {
      id: "finance",
      name: "Finance",
      url: "https://finance.delightfullabs.com/",
    },
  ];
</script>

<Portraits />

<div class="apps">
  {#each apps as app (app.id)}
    <section aria-labelledby={`${app.id}-title`}>
      <header>
        <Heading level="h2" id={`${app.id}-title`}>{app.name}</Heading>
        <a
          href={app.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${app.name} in a new tab`}>Open app</a
        >
      </header>
      <iframe
        src={app.url}
        title={app.name}
        width="375"
        height="600"
        loading="lazy"
        allow="publickey-credentials-get; publickey-credentials-create"
      ></iframe>
    </section>
  {/each}
</div>

<style>
  .apps {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--dui-spacing-lg);
  }
  section {
    inline-size: 375px;
    max-inline-size: 100%;
    min-inline-size: 0;
    display: grid;
    gap: var(--dui-spacing-md);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--dui-spacing-md);
  }
  iframe {
    display: block;
    inline-size: 100%;
    border: 0;
  }
</style>
