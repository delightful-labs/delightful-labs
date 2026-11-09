import { BlobPreconditionFailedError } from "@vercel/blob";
import { createActor, createAsyncLogic, types, type InputFrom } from "xstate";
import { vi } from "vitest";
import { articleMachine } from "../../src/lib/server/leaflet/article-machine";
import { articlesMachine } from "../../src/lib/server/leaflet/articles-machine";
import { blobStoreMachine } from "../../src/lib/server/leaflet/blob-store-machine";
import { durableMachine } from "../../src/lib/server/leaflet/durable-machine";
import { readerMachine } from "../../src/lib/server/leaflet/reader-machine";
import { recordsMachine } from "../../src/lib/server/leaflet/records-machine";
import { requestMachine } from "../../src/lib/server/leaflet/request-machine";
import { snapshotMachine } from "../../src/lib/server/leaflet/snapshot-machine";
import { PublicationReader } from "../../src/lib/server/leaflet/reader";
import { runActor } from "./run-actor";
import { encodeSnapshot } from "../../src/lib/server/leaflet/snapshot-codec";
import type {
  ReaderConfig,
  Snapshot,
} from "../../src/lib/server/leaflet/model";
import type { SnapshotStore } from "./snapshots";
import { config } from "./snapshots";

type Load = (signal: AbortSignal) => Promise<Snapshot>;
export const storage = { storeId: "test-store", namespace: "test" };

// Keep the child state machines intact; substitute their I/O actors.
function sourceLogic(load: Load) {
  let result: Snapshot;
  const article = articleMachine.provide({
    actors: {
      prepareArticle: createAsyncLogic({
        schemas: { input: types<InputFrom<typeof articleMachine>>() },
        run: async ({ input }) => {
          const article = result.articles.find(
            (article) => article.uri === input.record.uri,
          );
          if (!article) throw new Error("Missing fixture article");
          return { article, content: null };
        },
      }),
    },
  });
  return snapshotMachine.provide({
    actors: {
      resolveIdentity: createAsyncLogic({
        schemas: { input: types<InputFrom<typeof snapshotMachine>>() },
        run: async ({ signal }) => {
          result = await load(signal);
          return "https://pds.example";
        },
      }),
      readCommit: createAsyncLogic({ run: async () => "commit" }),
      readPublication: createAsyncLogic({
        run: async () => result.publication,
      }),
      enumerateRecords: recordsMachine.provide({
        actors: {
          fetchPage: createAsyncLogic({
            run: async () => ({
              records: result.articles.map((article) => ({
                uri: article.uri,
                cid: article.cid,
                value: {
                  $type: "site.standard.document" as const,
                  site: config.publicationUri,
                },
              })),
            }),
          }),
        },
      }),
      prepareArticles: articlesMachine.provide({
        actors: { loadArticle: article },
      }),
      captureVerificationTime: createAsyncLogic({
        run: async () => result.verifiedAt,
      }),
    },
  });
}

export function durableLogic(
  store: SnapshotStore,
  load: Load,
  now: () => number,
) {
  const blob = blobStoreMachine.provide({
    actors: {
      downloadSnapshot: createAsyncLogic({
        schemas: {
          input:
            types<
              InputFrom<typeof blobStoreMachine._actorMap.downloadSnapshot>
            >(),
        },
        run: async ({ signal }) => {
          const stored = await store.read(signal);
          return stored
            ? {
                body: encodeSnapshot(
                  stored.snapshot,
                  config,
                  storage.namespace,
                ),
                version: stored.version,
              }
            : null;
        },
      }),
      uploadSnapshot: createAsyncLogic({
        schemas: {
          input:
            types<
              InputFrom<typeof blobStoreMachine._actorMap.uploadSnapshot>
            >(),
        },
        run: async ({ input, signal }) => {
          if (!(await store.write(input.snapshot, input.version, signal)))
            throw new BlobPreconditionFailedError();
        },
      }),
    },
  });
  return durableMachine.provide({
    actors: {
      blobOperation: blob,
      refreshSnapshot: sourceLogic(load),
      readClock: createAsyncLogic({ run: async () => now() }),
    },
  });
}

export function durableLoader(
  store: SnapshotStore,
  load: Load,
  now: () => number,
) {
  const logic = durableLogic(store, load, now);
  return async (signal: AbortSignal) => {
    const result = await runActor(
      createActor(logic, { input: { config, storage } }),
      signal,
    );
    if (!result.ok) throw result.error;
    return result.snapshot;
  };
}

export function readerLogic(load: Load, now: () => number) {
  return readerMachine.provide({
    actors: {
      requestSnapshot: requestMachine.provide({
        actors: { loadSource: sourceLogic(load) },
      }),
      readClock: createAsyncLogic({ run: async () => now() }),
    },
  });
}

export function storedReader(
  readerConfig: ReaderConfig,
  store: SnapshotStore,
  now: () => number,
  load: Load = async () => {
    throw new Error("must not fetch");
  },
) {
  vi.spyOn(Date, "now").mockImplementation(now);
  const request = requestMachine.provide({
    actors: {
      loadDurable: durableLogic(store, load, now),
    },
  });
  return new PublicationReader(
    readerConfig,
    storage,
    readerMachine.provide({ actors: { requestSnapshot: request } }),
  );
}
