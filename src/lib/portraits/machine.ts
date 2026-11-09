import { createAsyncLogic, createCallbackLogic, setup, types } from "xstate";

export const photos = ["IMG_0418", "IMG_0545", "IMG_0605", "IMG_0638"].map(
  (name) => `/profile/${name}.jpg`,
);
type Context = {
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
      RENDER_FAILED: types<{}>(),
    },
    input: types<{ reduced: boolean }>(),
  },
  actors: {
    frames,
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
    images: [],
    index: 0,
    progress: 1,
    reduced: input.reduced,
    active: true,
    paused: false,
  }),
  initial: "loading",
  on: {
    RENDER_FAILED: { target: ".fallback" },
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
    fallback: {},
    ready: {
      initial: "deciding",
      on: {
        ACTIVITY: ({ event }) => ({
          target: ".deciding",
          context: { active: event.active, progress: 1 },
        }),
        MOTION: ({ event }) => ({
          target: ".deciding",
          context: { reduced: event.reduced, progress: 1 },
        }),
        TOGGLE: ({ context }) => ({
          target: ".deciding",
          context: { paused: !context.paused, progress: 1 },
        }),
      },
      states: {
        deciding: {
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
            FRAME: ({ event, context }) =>
              event.elapsed >= 700
                ? {
                    target: "entering",
                    context: {
                      index: (context.index + 1) % context.images.length,
                      progress: 0,
                    },
                  }
                : { context: { progress: 1 - event.elapsed / 700 } },
          },
        },
        entering: {
          invoke: { src: "frames" },
          on: {
            FRAME: ({ event }) =>
              event.elapsed >= 700
                ? { target: "holding", context: { progress: 1 } }
                : { context: { progress: event.elapsed / 700 } },
          },
        },
      },
    },
  },
});
