import { describe, expect, it } from "vitest";
import {
  createActor,
  createAsyncLogic,
  createCallbackLogic,
  SimulatedClock,
} from "xstate";
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
      },
    }),
    { input: { reduced }, clock },
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
  it("stops rotation when rendering fails", async () => {
    const { actor, clock } = await rotation();
    actor.send({ type: "RENDER_FAILED" });
    clock.increment(10_000);
    expect(actor.getSnapshot().matches("fallback")).toBe(true);
    actor.stop();
  });
});
