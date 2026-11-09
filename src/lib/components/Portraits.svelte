<script lang="ts">
  import { onMount } from "svelte";
  import { createActor } from "xstate";
  import { photos, portraitMachine } from "#lib/portraits/machine.ts";

  let host: HTMLDivElement;
  let rendered = $state(false);
  let paused = $state(false);
  let reduced = $state(false);
  let current = $state(0);
  let toggle = $state(() => {});

  onMount(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const actor = createActor(portraitMachine, {
      input: { host, reduced: preference.matches },
    });
    let inView = true;
    const activity = () =>
      actor.send({ type: "ACTIVITY", active: inView && !document.hidden });
    const motion = () =>
      actor.send({ type: "MOTION", reduced: preference.matches });
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      activity();
    });
    const subscription = actor.subscribe((snapshot) => {
      paused = snapshot.context.paused;
      reduced = snapshot.context.reduced;
      current = snapshot.context.index;
      rendered =
        snapshot.matches("ready") && !snapshot.matches({ ready: "mounting" });
    });
    toggle = () => actor.send({ type: "TOGGLE" });
    actor.start();
    observer.observe(host);
    document.addEventListener("visibilitychange", activity);
    preference.addEventListener("change", motion);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", activity);
      preference.removeEventListener("change", motion);
      subscription.unsubscribe();
      actor.stop();
    };
  });
</script>

<div class="portraits">
  <div
    class="portrait"
    role="img"
    aria-label="Portrait of Matt Derocher"
    data-portrait={current}
  >
    <img src={photos[0]} alt="" width="720" height="960" fetchpriority="high" />
    <div
      class="shader"
      class:rendered
      bind:this={host}
      aria-hidden="true"
    ></div>
  </div>
  {#if rendered && !reduced}
    <button
      type="button"
      onclick={toggle}
      aria-label={paused ? "Play portrait rotation" : "Pause portrait rotation"}
    >
      {paused ? "Play" : "Pause"}
    </button>
  {/if}
</div>

<style>
  .portraits {
    display: grid;
    justify-items: center;
    gap: var(--dui-spacing-md);
    margin-block-end: var(--dui-spacing-xl);
  }
  .portrait {
    position: relative;
    inline-size: 320px;
    max-inline-size: 100%;
    aspect-ratio: 4 / 5;
  }
  img,
  .shader {
    position: absolute;
    inset: 0;
    inline-size: 100%;
    block-size: 100%;
  }
  img {
    object-fit: cover;
    filter: grayscale(1);
  }
  .shader {
    opacity: 0;
  }
  .shader.rendered {
    opacity: 1;
  }
</style>
