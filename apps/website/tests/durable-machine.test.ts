import { createActor } from "xstate";
import { runActor } from "./fixtures/run-actor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  durableLoader,
  durableLogic,
  storedReader,
  storage,
} from "./fixtures/machines";
import { MemorySnapshotStore, config, snapshot } from "./fixtures/snapshots";
import type { Snapshot } from "../src/lib/server/leaflet/model";
const signal = () => new AbortController().signal;
beforeEach(() => vi.spyOn(console, "info").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("durable publication snapshots", () => {
  it("creates the first snapshot and recovers it in a new reader without upstream work", async () => {
    const store = new MemorySnapshotStore();
    await durableLoader(
      store,
      async () => snapshot(100),
      () => 100,
    )(signal());
    const json = vi.fn(async () => {
      throw new Error("must not fetch");
    });
    const reader = storedReader(config, store, () => 200, json);
    expect((await reader.read())?.articles[0].key).toBe("one");
    expect(json).not.toHaveBeenCalled();
    reader.stop();
  });

  it("checks shared state even while an instance's local snapshot is fresh", async () => {
    const store = new MemorySnapshotStore(snapshot(100));
    const reader = storedReader(config, store, () => 200);
    await reader.read();
    await store.write(snapshot(150, []), "1", signal());
    expect((await reader.read())?.articles).toEqual([]);
    reader.stop();
  });

  it("coalesces simultaneous reads of shared storage", async () => {
    const store = new MemorySnapshotStore(snapshot(100));
    const read = vi.spyOn(store, "read");
    const reader = storedReader(config, store, () => 200);
    const [first, second] = await Promise.all([reader.read(), reader.read()]);
    expect(first).toEqual(second);
    expect(read).toHaveBeenCalledOnce();
    reader.stop();
  });

  it("does not serve a local copy when shared state is unreadable", async () => {
    const store = new MemorySnapshotStore(snapshot(100));
    const reader = storedReader(config, store, () => 200);
    await reader.read();
    store.failure = new Error("storage unavailable");
    await expect(reader.read()).rejects.toThrow("storage unavailable");
    reader.stop();
  });

  it("discards a slower scan after another instance confirms a deletion", async () => {
    const store = new MemorySnapshotStore(snapshot(0));
    const slow = Promise.withResolvers<Snapshot>();
    const started = Promise.withResolvers<void>();
    const first = durableLoader(
      store,
      async () => {
        started.resolve();
        return slow.promise;
      },
      () => 301_000,
    )(signal());
    await started.promise;
    const winner = await durableLoader(
      store,
      async () => snapshot(301_000, []),
      () => 301_000,
    )(signal());
    slow.resolve(snapshot(301_001));
    expect(winner.articles).toEqual([]);
    expect((await first).articles).toEqual([]);
    expect(store.current?.snapshot.articles).toEqual([]);
  });

  it("does not overwrite a concurrent first snapshot", async () => {
    const store = new MemorySnapshotStore();
    const slow = Promise.withResolvers<Snapshot>();
    const started = Promise.withResolvers<void>();
    const first = durableLoader(
      store,
      async () => {
        started.resolve();
        return slow.promise;
      },
      () => 10,
    )(signal());
    await started.promise;
    await durableLoader(
      store,
      async () => snapshot(10, []),
      () => 10,
    )(signal());
    slow.resolve(snapshot(10));
    expect((await first).articles).toEqual([]);
  });

  it("re-reads a concurrent winner after upstream failure instead of serving the old body", async () => {
    const store = new MemorySnapshotStore(snapshot(0));
    const result = await durableLoader(
      store,
      async () => {
        await store.write(snapshot(301_000, []), "1", signal());
        throw new Error("upstream unavailable");
      },
      () => 301_000,
    )(signal());
    expect(result.articles).toEqual([]);
    expect(result.stale).toBe(false);
  });

  it("refreshes at the exact freshness boundary", async () => {
    const store = new MemorySnapshotStore(snapshot(0));
    const load = vi.fn(async () => snapshot(300_000, []));
    expect(
      (await durableLoader(store, load, () => 300_000)(signal())).articles,
    ).toEqual([]);
    expect(load).toHaveBeenCalledOnce();
  });

  it("serves stale data without changing verification time, then expires it", async () => {
    const store = new MemorySnapshotStore(snapshot(0));
    let now = 301_000;
    const load = durableLoader(
      store,
      async () => {
        throw new Error("upstream unavailable");
      },
      () => now,
    );
    expect(await load(signal())).toMatchObject({ verifiedAt: 0, stale: true });
    now = 86_400_000;
    expect((await load(signal())).stale).toBe(true);
    now++;
    await expect(load(signal())).rejects.toThrow("expired");
    expect(store.current?.snapshot.verifiedAt).toBe(0);
  });

  it("checks stale expiry after a slow failed refresh", async () => {
    const store = new MemorySnapshotStore(snapshot(0));
    let now = 86_399_000;
    await expect(
      durableLoader(
        store,
        async () => {
          now = 86_400_001;
          throw new Error("upstream");
        },
        () => now,
      )(signal()),
    ).rejects.toThrow("expired");
  });

  it("rejects future verification timestamps rather than extending freshness", async () => {
    const store = new MemorySnapshotStore(snapshot(1_000));
    await expect(
      durableLoader(
        store,
        async () => snapshot(0),
        () => 0,
      )(signal()),
    ).rejects.toThrow();
  });

  it("does not fabricate an empty publication after a failed first refresh", async () => {
    const store = new MemorySnapshotStore();
    await expect(
      durableLoader(
        store,
        async () => {
          throw new Error("upstream");
        },
        () => 0,
      )(signal()),
    ).rejects.toThrow("upstream");
    expect(store.current).toBeNull();
  });

  it("refuses to return an uncommitted first snapshot when persistence fails", async () => {
    const store = new MemorySnapshotStore();
    vi.spyOn(store, "write").mockRejectedValue(new Error("write failed"));
    await expect(
      durableLoader(
        store,
        async () => snapshot(0),
        () => 0,
      )(signal()),
    ).rejects.toThrow("write failed");
  });

  it("does not convert cancellation into a stale success", async () => {
    const store = new MemorySnapshotStore(snapshot(0));
    const controller = new AbortController();
    await expect(
      durableLoader(
        store,
        async () => {
          controller.abort(new Error("cancelled"));
          throw new Error("upstream");
        },
        () => 301_000,
      )(controller.signal),
    ).rejects.toThrow("cancelled");
  });
});

describe("durable snapshot lifecycle", () => {
  it("moves through recovery after losing a commit and returns the authoritative winner", async () => {
    const store = new MemorySnapshotStore(snapshot(0));
    vi.spyOn(store, "write").mockImplementation(async () => {
      store.current = { snapshot: snapshot(301_000, []), version: "winner" };
      return false;
    });
    const actor = createActor(
      durableLogic(
        store,
        async () => snapshot(301_000),
        () => 301_000,
      ),
      {
        input: { config, storage },
      },
    );
    const states: unknown[] = [];
    actor.subscribe((state) => states.push(state.value));
    const result = await runActor(actor, signal());
    expect(result).toMatchObject({
      ok: true,
      outcome: "winner",
      snapshot: { articles: [] },
    });
    expect(states).toEqual([
      "reading",
      "capturingReadTime",
      "refreshing",
      "committing",
      "recovering",
      "capturingRecoveryTime",
      "winner",
    ]);
  });

  it("enters stale after a failed refresh without resetting verification time", async () => {
    const actor = createActor(
      durableLogic(
        new MemorySnapshotStore(snapshot(0)),
        async () => {
          throw new Error("upstream unavailable");
        },
        () => 301_000,
      ),
      {
        input: { config, storage },
      },
    );
    const states: unknown[] = [];
    actor.subscribe((state) => states.push(state.value));
    expect(await runActor(actor, signal())).toMatchObject({
      ok: true,
      outcome: "stale",
      snapshot: { stale: true, verifiedAt: 0 },
    });
    expect(states).toEqual([
      "reading",
      "capturingReadTime",
      "refreshing",
      "recovering",
      "capturingRecoveryTime",
      "stale",
    ]);
  });

  it("fails when recovery storage is unreadable rather than returning the old body", async () => {
    const store = new MemorySnapshotStore(snapshot(0));
    await expect(
      durableLoader(
        store,
        async () => {
          store.failure = new Error("recovery unavailable");
          throw new Error("upstream unavailable");
        },
        () => 301_000,
      )(signal()),
    ).rejects.toThrow("recovery unavailable");
  });

  it.each(["reading", "committing"] as const)(
    "cancels durable %s work",
    async (stage) => {
      const store = new MemorySnapshotStore();
      const entered = Promise.withResolvers<void>();
      const controller = new AbortController();
      let activeSignal: AbortSignal | undefined;
      const wait = async (signal: AbortSignal) => {
        activeSignal = signal;
        entered.resolve();
        return new Promise<never>(() => {});
      };
      if (stage === "reading") vi.spyOn(store, "read").mockImplementation(wait);
      else
        vi.spyOn(store, "write").mockImplementation(async (_, __, signal) =>
          wait(signal),
        );
      const pending = durableLoader(
        store,
        async () => snapshot(0),
        () => 0,
      )(controller.signal);
      const failure = new Error("cancelled durable operation");
      const rejected = expect(pending).rejects.toBe(failure);
      await entered.promise;
      controller.abort(failure);
      await rejected;
      expect(activeSignal?.aborted).toBe(true);
      expect(store.current).toBeNull();
    },
  );
});
