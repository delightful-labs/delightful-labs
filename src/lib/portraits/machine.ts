import { createAsyncLogic, createCallbackLogic, setup, types } from "xstate";

import { portraitRenderer } from "./renderer";

export const photos = ["IMG_0418", "IMG_0545", "IMG_0605", "IMG_0638"].map(
  (name) => `/profile/${name}.jpg`,
);
type Context = {
  host: HTMLDivElement;
  images: HTMLImageElement[];
  index: number;
  progress: number;
  reduced: boolean;
  active: boolean;
  paused: boolean;
};

const frames = createCallbackLogic(({ sendBack }) => {
  const start = performance.now();
  let frame = requestAnimationFrame(tick);
  function tick(now: number) {
    frame = requestAnimationFrame(tick);
    sendBack({ type: "FRAME", elapsed: now - start });
  }
  return () => cancelAnimationFrame(frame);
});

export const portraitMachine = setup({
  schemas: {
    context: types<Context>(),
    events: {
      FRAME: types<{ elapsed: number }>(),
      ACTIVITY: types<{ active: boolean }>(),
      MOTION: types<{ reduced: boolean }>(),
      TOGGLE: types<{}>(),
      RENDER_READY: types<{}>(),
    },
    input: types<{ host: HTMLDivElement; reduced: boolean }>(),
  },
  actors: {
    frames,
    renderer: portraitRenderer,
    loadImages: createAsyncLogic({
      run: async () =>
        Promise.all(
          photos.map(async (src) => {
            const image = new Image();
            image.src = src;
            await image.decode();
            return image;
          }),
        ),
    }),
  },
}).createMachine({
  id: "portraits",
  context: ({ input }) => ({
    host: input.host,
    images: [],
    index: 0,
    progress: 1,
    reduced: input.reduced,
    active: true,
    paused: false,
  }),
  initial: "loading",
  on: {
    ACTIVITY: ({ event }) => ({ context: { active: event.active } }),
    MOTION: ({ event }) => ({ context: { reduced: event.reduced } }),
  },
  states: {
    loading: {
      invoke: {
        src: "loadImages",
        onDone: ({ event }) => ({
          target: "ready",
          context: { images: event.output },
        }),
        onError: { target: "fallback" },
      },
    },
    fallback: {
      // Also remove a canvas left behind by a failed WebGL constructor.
      entry: ({ context }, enqueue) =>
        enqueue(() => context.host.replaceChildren()),
    },
    ready: {
      initial: "mounting",
      invoke: {
        id: "renderer",
        src: "renderer",
        input: ({ context }) => ({
          host: context.host,
          image: context.images[0],
        }),
        onError: { target: "fallback" },
        onDone: { target: "fallback" },
      },
      on: {
        ACTIVITY: ({ event }) => {
          return {
            target: ".deciding",
            context: { active: event.active, progress: 1 },
          };
        },
        MOTION: ({ event }) => {
          return {
            target: ".deciding",
            context: { reduced: event.reduced, progress: 1 },
          };
        },
        TOGGLE: ({ context }) => {
          return {
            target: ".deciding",
            context: { paused: !context.paused, progress: 1 },
          };
        },
      },
      states: {
        mounting: { on: { RENDER_READY: { target: "deciding" } } },
        deciding: {
          entry: ({ context }, enqueue) =>
            enqueue.sendTo("renderer", {
              type: "DRAW",
              image: context.images[context.index],
              progress: 1,
            }),
          always: ({ context }) => ({
            target:
              context.reduced || !context.active || context.paused
                ? "paused"
                : "holding",
          }),
        },
        paused: {},
        holding: { after: { 4500: { target: "exiting" } } },
        exiting: {
          invoke: { src: "frames" },
          on: {
            FRAME: ({ event, context }, enqueue) => {
              const complete = event.elapsed >= 700;
              const index = complete
                ? (context.index + 1) % context.images.length
                : context.index;
              const progress = complete ? 0 : 1 - event.elapsed / 700;
              enqueue.sendTo("renderer", {
                type: "DRAW",
                image: context.images[index],
                progress,
              });
              return {
                target: complete ? "entering" : undefined,
                context: { index, progress },
              };
            },
          },
        },
        entering: {
          invoke: { src: "frames" },
          on: {
            FRAME: ({ event, context }, enqueue) => {
              const complete = event.elapsed >= 700;
              const progress = complete ? 1 : event.elapsed / 700;
              enqueue.sendTo("renderer", {
                type: "DRAW",
                image: context.images[context.index],
                progress,
              });
              return {
                target: complete ? "holding" : undefined,
                context: { progress },
              };
            },
          },
        },
      },
    },
  },
});
