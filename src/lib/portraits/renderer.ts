import { ShaderMount } from "@paper-design/shaders";
import { createAsyncLogic, createCallbackLogic, setup, types } from "xstate";
import { portraitShader, portraitUniforms } from "./shader";

type Input = { host: HTMLDivElement; image: HTMLImageElement };
type Context = Input & { shader?: ShaderMount; progress: number };

// This actor only acquires/releases the GPU resource. Texture writes are a
// separate invoked operation, so their failure cannot skip resource cleanup.
const mount = createCallbackLogic<never, Input>(({ input, sendBack }) => {
  const shader = new ShaderMount(
    input.host,
    portraitShader,
    { ...portraitUniforms(input.image), u_reveal: 1 },
    undefined,
    0,
    0,
    1,
    640_000,
  );
  sendBack({ type: "MOUNTED", shader });
  return () => shader.dispose();
});

export const portraitRenderer = setup({
  schemas: {
    context: types<Context>(),
    input: types<Input>(),
    events: {
      MOUNTED: types<{ shader: ShaderMount }>(),
      DRAW: types<{ image: HTMLImageElement; progress: number }>(),
    },
  },
  actors: {
    mount,
    draw: createAsyncLogic({
      schemas: {
        input: types<{
          shader: ShaderMount;
          image: HTMLImageElement;
          progress: number;
        }>(),
      },
      run: async ({ input }) =>
        input.shader.setUniforms({
          u_image: input.image,
          u_reveal: input.progress,
        }),
    }),
  },
}).createMachine({
  id: "portraitRenderer",
  context: ({ input }) => ({ ...input, progress: 1 }),
  initial: "mounting",
  invoke: {
    src: "mount",
    input: ({ context }) => ({ host: context.host, image: context.image }),
    onError: { target: ".failed" },
  },
  states: {
    mounting: {
      on: {
        MOUNTED: ({ event }) => ({
          target: "ready",
          context: { shader: event.shader },
        }),
      },
    },
    ready: {
      initial: "announcing",
      on: {
        DRAW: ({ event }) => ({
          target: ".drawing",
          reenter: true,
          context: { image: event.image, progress: event.progress },
        }),
      },
      states: {
        announcing: {
          entry: ({ parent }, enqueue) =>
            enqueue.sendTo(parent, { type: "RENDER_READY" }),
          always: { target: "idle" },
        },
        idle: {},
        drawing: {
          invoke: {
            src: "draw",
            input: ({ context }) => ({
              shader: context.shader!,
              image: context.image,
              progress: context.progress,
            }),
            onDone: { target: "idle" },
            onError: { target: "#portraitRenderer.failed" },
          },
        },
      },
    },
    failed: { type: "final" },
  },
});
