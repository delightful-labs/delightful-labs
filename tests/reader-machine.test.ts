import { createActor } from "xstate";
import { describe, expect, it, vi } from "vitest";
import {
  readerMachine,
  type ReaderActor,
} from "../src/lib/server/leaflet/reader-machine";
import type { Snapshot } from "../src/lib/server/leaflet/model";

const snapshot = (verifiedAt = 0): Snapshot => ({
  publication: {
    uri: "at://did:plc:test/site.standard.publication/test",
    name: "Test",
    sourceUrl: "https://test.leaflet.pub",
  },
  articles: [],
  verifiedAt,
  stale: false,
});
function read(actor: ReaderActor, at: number) {
  return new Promise<Snapshot | null>((resolve, reject) =>
    actor.send({ type: "READ", at, reply: { resolve, reject } }),
  );
}

describe("reader lifecycle", () => {
  it("stays unconfigured without starting work", async () => {
    const load = vi.fn();
    const actor = createActor(readerMachine, {
      input: { configured: false, load, now: () => 0 },
    }).start();
    expect(actor.getSnapshot().matches("unconfigured")).toBe(true);
    expect(await read(actor, 0)).toBeNull();
    expect(load).not.toHaveBeenCalled();
    actor.stop();
  });
  it("shares one invocation while loading and serves fresh cache without fetching", async () => {
    const deferred = Promise.withResolvers<Snapshot>();
    const load = vi.fn(() => deferred.promise);
    const actor = createActor(readerMachine, {
      input: { configured: true, load, now: () => 0 },
    }).start();
    expect(actor.getSnapshot().matches("empty")).toBe(true);
    const first = read(actor, 0),
      second = read(actor, 0);
    expect(actor.getSnapshot().matches("loading")).toBe(true);
    deferred.resolve(snapshot());
    expect(await first).toEqual(await second);
    expect(actor.getSnapshot().matches("ready")).toBe(true);
    expect(await read(actor, 299_999)).toEqual(snapshot());
    expect(load).toHaveBeenCalledTimes(1);
    actor.stop();
  });
  it("keeps verification age on a failed refresh and recovers on a later read", async () => {
    let now = 0;
    const load = vi
      .fn()
      .mockResolvedValueOnce(snapshot())
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(snapshot(302_000));
    const actor = createActor(readerMachine, {
      input: { configured: true, load, now: () => now },
    }).start();
    await read(actor, now);
    now = 300_000;
    const result = await read(actor, now);
    expect(actor.getSnapshot().matches("stale")).toBe(true);
    expect(result).toMatchObject({ stale: true, verifiedAt: 0 });
    now = 302_000;
    await read(actor, now);
    expect(actor.getSnapshot().matches("ready")).toBe(true);
    expect(actor.getSnapshot().context.waiters).toEqual([]);
    actor.stop();
  });
  it("shares one refresh and releases every waiter on success", async () => {
    let now = 0;
    const deferred = Promise.withResolvers<Snapshot>();
    const load = vi
      .fn()
      .mockResolvedValueOnce(snapshot())
      .mockImplementationOnce(() => deferred.promise);
    const actor = createActor(readerMachine, {
      input: { configured: true, load, now: () => now },
    }).start();
    await read(actor, now);
    now = 300_000;
    const first = read(actor, now),
      second = read(actor, now);
    expect(actor.getSnapshot().matches("refreshing")).toBe(true);
    deferred.resolve(snapshot(now));
    expect(await first).toEqual(await second);
    expect(load).toHaveBeenCalledTimes(2);
    expect(actor.getSnapshot().context.waiters).toEqual([]);
    actor.stop();
  });
  it("does not serve cache that expires while a refresh is pending", async () => {
    let now = 0;
    const deferred = Promise.withResolvers<Snapshot>();
    const load = vi
      .fn()
      .mockResolvedValueOnce(snapshot())
      .mockImplementationOnce(() => deferred.promise);
    const actor = createActor(readerMachine, {
      input: { configured: true, load, now: () => now },
    }).start();
    await read(actor, now);
    now = 300_000;
    const pending = read(actor, now);
    expect(actor.getSnapshot().matches("refreshing")).toBe(true);
    now = 86_400_001;
    deferred.reject(new Error("offline"));
    await expect(pending).rejects.toThrow("offline");
    expect(actor.getSnapshot().matches("unavailable")).toBe(true);
    actor.stop();
  });
  it("retries after an initial failure", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(snapshot());
    const actor = createActor(readerMachine, {
      input: { configured: true, load, now: () => 0 },
    }).start();
    await expect(read(actor, 0)).rejects.toThrow("offline");
    expect(actor.getSnapshot().matches("unavailable")).toBe(true);
    await read(actor, 0);
    expect(actor.getSnapshot().matches("ready")).toBe(true);
    actor.stop();
  });
  it("aborts work and settles every caller when stopped", async () => {
    let signal: AbortSignal | undefined;
    const deferred = Promise.withResolvers<Snapshot>();
    const load = vi.fn((value: AbortSignal) => {
      signal = value;
      return deferred.promise;
    });
    const actor = createActor(readerMachine, {
      input: { configured: true, load, now: () => 0 },
    }).start();
    const first = read(actor, 0),
      second = read(actor, 0);
    actor.send({ type: "STOP" });
    await expect(first).rejects.toThrow("stopped");
    await expect(second).rejects.toThrow("stopped");
    expect(signal?.aborted).toBe(true);
    expect(actor.getSnapshot().matches("stopped")).toBe(true);
    expect(actor.getSnapshot().context.waiters).toEqual([]);
    deferred.resolve(snapshot());
    await Promise.resolve();
    expect(actor.getSnapshot().matches("stopped")).toBe(true);
    expect(actor.getSnapshot().context.cache).toBeNull();
  });
});
