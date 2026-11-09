import { describe, expect, it } from "vitest";
import {
  createActor,
  createAsyncLogic,
  createCallbackLogic,
  SimulatedClock,
} from "xstate";
import { portraitRenderer } from "../src/lib/portraits/renderer";
import type { ShaderMount } from "@paper-design/shaders";
import { portraitMachine } from "../src/lib/portraits/machine";

async function rotation(reduced = false) {
  const clock = new SimulatedClock();
  const actor = createActor(
    portraitMachine.provide({
      actors: {
        loadImages: createAsyncLogic({
          run: async () =>
            Array.from({ length: 4 }, () => ({}) as HTMLImageElement),
        }),
        frames: createCallbackLogic(() => {}),
        renderer: portraitRenderer.provide({
          actors: {
            mount: createCallbackLogic(({ sendBack }) => {
              sendBack({ type: "MOUNTED", shader: {} as ShaderMount });
            }),
            draw: createAsyncLogic({ run: async () => {} }),
          },
        }),
      },
    }),
    {
      input: {
        host: { replaceChildren() {} } as unknown as HTMLDivElement,
        reduced,
      },
      clock,
    },
  );
  actor.start();
  await Promise.resolve();
  await Promise.resolve();
  return { actor, clock };
}

describe("portrait rotation", () => {
  it("holds, dissolves, advances all four portraits and wraps", async () => {
    const { actor, clock } = await rotation();
    for (const index of [1, 2, 3, 0]) {
      expect(actor.getSnapshot().matches({ ready: "holding" })).toBe(true);
      clock.increment(4500);
      expect(actor.getSnapshot().matches({ ready: "exiting" })).toBe(true);
      actor.send({ type: "FRAME", elapsed: 350 });
      expect(actor.getSnapshot().context.progress).toBe(0.5);
      actor.send({ type: "FRAME", elapsed: 700 });
      expect(actor.getSnapshot().context.index).toBe(index);
      expect(actor.getSnapshot().context.progress).toBe(0);
      actor.send({ type: "FRAME", elapsed: 700 });
      expect(actor.getSnapshot().context.progress).toBe(1);
    }
    actor.stop();
  });
  it("preserves a manual pause across visibility changes", async () => {
    const { actor, clock } = await rotation();
    actor.send({ type: "TOGGLE" });
    actor.send({ type: "ACTIVITY", active: false });
    actor.send({ type: "ACTIVITY", active: true });
    clock.increment(10_000);
    expect(actor.getSnapshot().matches({ ready: "paused" })).toBe(true);
    expect(actor.getSnapshot().context.index).toBe(0);
    actor.send({ type: "TOGGLE" });
    expect(actor.getSnapshot().matches({ ready: "holding" })).toBe(true);
    actor.stop();
  });
  it("keeps reduced motion static and honors preference changes", async () => {
    const { actor, clock } = await rotation(true);
    clock.increment(10_000);
    expect(actor.getSnapshot().matches({ ready: "paused" })).toBe(true);
    actor.send({ type: "MOTION", reduced: false });
    clock.increment(4500);
    actor.send({ type: "FRAME", elapsed: 350 });
    actor.send({ type: "MOTION", reduced: true });
    expect(actor.getSnapshot().matches({ ready: "paused" })).toBe(true);
    expect(actor.getSnapshot().context.progress).toBe(1);
    actor.stop();
  });
  it("falls back when the renderer cannot start", async () => {
    const host = {
      replaceChildren: () => {
        cleared = true;
      },
    };
    let cleared = false;
    const actor = createActor(
      portraitMachine.provide({
        actors: {
          loadImages: createAsyncLogic({
            run: async () => [{} as HTMLImageElement],
          }),
          renderer: portraitRenderer.provide({
            actors: {
              mount: createCallbackLogic(() => {
                throw new Error("No WebGL");
              }),
            },
          }),
        },
      }),
      { input: { host: host as unknown as HTMLDivElement, reduced: false } },
    );
    actor.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(actor.getSnapshot().matches("fallback")).toBe(true);
    expect(cleared).toBe(true);
    actor.stop();
  });
  it("releases the renderer when an image update throws", async () => {
    let disposed = false;
    let cleared = false;
    const actor = createActor(
      portraitMachine.provide({
        actors: {
          loadImages: createAsyncLogic({
            run: async () => [{} as HTMLImageElement],
          }),
          renderer: portraitRenderer.provide({
            actors: {
              mount: createCallbackLogic(({ sendBack }) => {
                sendBack({ type: "MOUNTED", shader: {} as ShaderMount });
                return () => {
                  disposed = true;
                };
              }),
              draw: createAsyncLogic({
                run: async () => {
                  throw new Error("Texture update failed");
                },
              }),
            },
          }),
        },
      }),
      {
        input: {
          host: {
            replaceChildren() {
              cleared = true;
            },
          } as unknown as HTMLDivElement,
          reduced: false,
        },
      },
    );
    actor.start();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(actor.getSnapshot().matches("fallback")).toBe(true);
    expect(disposed).toBe(true);
    expect(cleared).toBe(true);
    actor.stop();
  });
});
