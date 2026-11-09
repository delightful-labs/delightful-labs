import { createActor, toPromise } from "xstate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { snapshotMachine } from "../src/lib/server/leaflet/snapshot-machine";
import { readJson } from "../src/lib/server/leaflet/http";
import { runActor } from "./fixtures/run-actor";
vi.mock("../src/lib/server/leaflet/http", () => ({ readJson: vi.fn() }));
afterEach(() => vi.restoreAllMocks());
function loadSnapshot(
  config: Parameters<typeof createSnapshot>[0],
  json: JsonReader,
  now: () => number,
  signal: AbortSignal,
) {
  vi.mocked(readJson).mockImplementation(json);
  vi.spyOn(Date, "now").mockImplementation(now);
  return runActor(createSnapshot(config), signal);
}
function createSnapshot(config: {
  ownerDid: string;
  publicationUri: string;
  publicationKey: string;
}) {
  return createActor(snapshotMachine, { input: { config } });
}
import type { JsonReader } from "../src/lib/server/leaflet/model";

const config = {
  ownerDid: "did:plc:testowner",
  publicationUri: "at://did:plc:testowner/site.standard.publication/test",
  publicationKey: "test",
};
const stages = [
  "resolvingIdentity",
  "readingInitialCommit",
  "readingPublication",
  "enumeratingRecords",
  "preparingArticles",
  "verifyingCommit",
];
function fixture(
  before?: (stage: string, signal?: AbortSignal) => Promise<void>,
): JsonReader {
  let commits = 0;
  return async (url, signal) => {
    const path = new URL(url).pathname;
    const stage = path.includes("getLatestCommit")
      ? ++commits === 1
        ? stages[1]
        : stages[5]
      : path.includes("getRecord")
        ? stages[2]
        : path.includes("listRecords")
          ? stages[3]
          : path.includes("getBlob")
            ? stages[4]
            : stages[0];
    await before?.(stage, signal);
    if (stage === stages[0])
      return {
        id: config.ownerDid,
        service: [
          { id: "#atproto_pds", serviceEndpoint: "https://pds.example" },
        ],
      };
    if (path.includes("getLatestCommit")) return { cid: "commit", rev: "rev" };
    if (stage === stages[2])
      return {
        uri: config.publicationUri,
        value: {
          $type: "site.standard.publication",
          name: "Fixture",
          url: "https://example.com",
        },
      };
    if (stage === stages[3])
      return {
        records: [
          {
            uri: `at://${config.ownerDid}/site.standard.document/post`,
            cid: "cid",
            value: {
              $type: "site.standard.document",
              site: config.publicationUri,
              title: "Fixture",
              publishedAt: "2023-01-01T00:00:00Z",
              content: {
                $type: "pub.leaflet.content",
                blobPages: {
                  ref: { $link: "baaaaaaaaaa" },
                  mimeType: "application/json",
                  size: 100,
                },
              },
            },
          },
        ],
      };
    return [
      { $type: "pub.leaflet.pages.linearDocument", id: "root", blocks: [] },
    ];
  };
}

describe("snapshot loading machine", () => {
  it("exposes ordered stages and publishes only a verified snapshot", async () => {
    vi.mocked(readJson).mockImplementation(fixture());
    vi.spyOn(Date, "now").mockReturnValue(123);
    const actor = createSnapshot(config);
    const visited: unknown[] = [];
    actor.subscribe((snapshot) => visited.push(snapshot.value));
    const result = toPromise(actor);
    actor.start();
    expect(await result).toMatchObject({
      verifiedAt: 123,
      stale: false,
      articles: [{ key: "post" }],
    });
    expect(visited).toEqual([...stages, "recordingVerification", "complete"]);
  });

  it.each(stages)(
    "aborts a stalled %s at the machine deadline",
    async (blockedStage) => {
      vi.useFakeTimers();
      try {
        let activeSignal: AbortSignal | undefined;
        const entered = Promise.withResolvers<void>();
        const pending = loadSnapshot(
          config,
          fixture(async (stage, signal) => {
            if (stage !== blockedStage) return;
            activeSignal = signal;
            entered.resolve();
            await new Promise(() => {});
          }),
          () => 0,
          new AbortController().signal,
        );
        const failed = expect(pending).rejects.toThrow(
          "Archive refresh timeout",
        );
        await entered.promise;
        await vi.advanceTimersByTimeAsync(40_000);
        await failed;
        expect(activeSignal?.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("keeps one deadline across source stages", async () => {
    vi.useFakeTimers();
    try {
      let activeSignal: AbortSignal | undefined;
      const entered = Promise.withResolvers<void>();
      const pending = loadSnapshot(
        config,
        fixture(async (stage, signal) => {
          if (stage === stages[0])
            await new Promise((resolve) => setTimeout(resolve, 30_000));
          if (stage === stages[1]) {
            activeSignal = signal;
            entered.resolve();
            await new Promise(() => {});
          }
        }),
        () => 0,
        new AbortController().signal,
      );
      const failed = expect(pending).rejects.toThrow("Archive refresh timeout");
      await vi.advanceTimersByTimeAsync(30_000);
      await entered.promise;
      await vi.advanceTimersByTimeAsync(10_000);
      await failed;
      expect(activeSignal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(stages)(
    "propagates failure in %s without running later stages",
    async (failedStage) => {
      const visited: string[] = [];
      const failure = new Error(`Failed ${failedStage}`);
      await expect(
        loadSnapshot(
          config,
          fixture(async (stage) => {
            visited.push(stage);
            if (stage === failedStage) throw failure;
          }),
          () => 0,
          new AbortController().signal,
        ),
      ).rejects.toBe(failure);
      expect(visited).toEqual(stages.slice(0, stages.indexOf(failedStage) + 1));
    },
  );

  it.each(stages)(
    "cancels active work in %s and never starts later stages",
    async (cancelStage) => {
      const controller = new AbortController();
      const reason = new Error("Cancelled");
      const visited: string[] = [];
      let activeSignal: AbortSignal | undefined;
      let entered!: () => void;
      const reached = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const pending = loadSnapshot(
        config,
        fixture(async (stage, signal) => {
          visited.push(stage);
          if (stage !== cancelStage) return;
          activeSignal = signal;
          entered();
          await new Promise((_, reject) =>
            signal!.addEventListener("abort", () => reject(signal!.reason), {
              once: true,
            }),
          );
        }),
        () => 0,
        controller.signal,
      );
      const rejected = expect(pending).rejects.toBe(reason);
      await reached;
      controller.abort(reason);
      await rejected;
      expect(activeSignal?.aborted).toBe(true);
      expect(visited).toEqual(stages.slice(0, stages.indexOf(cancelStage) + 1));
    },
  );
});
