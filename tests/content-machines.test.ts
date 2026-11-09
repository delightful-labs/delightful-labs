import { createActor } from "xstate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { articleMachine } from "../src/lib/server/leaflet/article-machine";
import { articlesMachine } from "../src/lib/server/leaflet/articles-machine";
import { recordsMachine } from "../src/lib/server/leaflet/records-machine";
import { readJson } from "../src/lib/server/leaflet/http";
import { runActor } from "./fixtures/run-actor";
import { config } from "./fixtures/snapshots";
import type { DocumentRecord } from "../src/lib/server/leaflet/schemas";

vi.mock("../src/lib/server/leaflet/http", () => ({ readJson: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const pds = "https://pds.example";
const pages = [
  { $type: "pub.leaflet.pages.linearDocument", id: "root", blocks: [] },
];
const record = (
  key: string,
  content: unknown = { $type: "pub.leaflet.content", pages },
): DocumentRecord => ({
  uri: `at://${config.ownerDid}/site.standard.document/${key}`,
  cid: "cid",
  value: {
    $type: "site.standard.document",
    site: config.publicationUri,
    title: key,
    publishedAt: "2023-01-01T00:00:00Z",
    content,
  },
});
const blob = {
  ref: { $link: "baaaaaaaaaa" },
  mimeType: "application/json",
  size: 100,
};
const signal = () => new AbortController().signal;

describe("record pagination machine", () => {
  it("fetches and validates each page before advancing its cursor", async () => {
    vi.mocked(readJson)
      .mockResolvedValueOnce({ records: [record("one")], cursor: "next" })
      .mockResolvedValueOnce({ records: [record("two")] });
    const actor = createActor(recordsMachine, {
      input: { pds, ownerDid: config.ownerDid },
    });
    const states: unknown[] = [];
    actor.subscribe((state) => states.push(state.value));
    expect((await runActor(actor, signal())).map((row) => row.uri)).toEqual([
      record("one").uri,
      record("two").uri,
    ]);
    expect(states).toEqual([
      "fetchingPage",
      "validatingPage",
      "fetchingPage",
      "validatingPage",
      "complete",
    ]);
    expect(
      new URL(vi.mocked(readJson).mock.calls[1][0]).searchParams.get("cursor"),
    ).toBe("next");
  });

  it("rejects duplicate identities across pages", async () => {
    vi.mocked(readJson)
      .mockResolvedValueOnce({ records: [record("one")], cursor: "next" })
      .mockResolvedValueOnce({ records: [record("one")] });
    await expect(
      runActor(
        createActor(recordsMachine, {
          input: { pds, ownerDid: config.ownerDid },
        }),
        signal(),
      ),
    ).rejects.toThrow("Duplicate record identity");
  });

  it("rejects a cursor loop rather than returning a partial inventory", async () => {
    vi.mocked(readJson).mockResolvedValue({ records: [], cursor: "repeated" });
    await expect(
      runActor(
        createActor(recordsMachine, {
          input: { pds, ownerDid: config.ownerDid },
        }),
        signal(),
      ),
    ).rejects.toThrow("Repeated cursor");
    expect(readJson).toHaveBeenCalledTimes(2);
  });

  it("bounds pagination even when all pages are empty", async () => {
    let page = 0;
    vi.mocked(readJson).mockImplementation(async () => ({
      records: [],
      cursor: String(++page),
    }));
    await expect(
      runActor(
        createActor(recordsMachine, {
          input: { pds, ownerDid: config.ownerDid },
        }),
        signal(),
      ),
    ).rejects.toThrow("Pagination limit");
    expect(readJson).toHaveBeenCalledTimes(201);
  });

  it("bounds the complete inventory", async () => {
    let page = 0;
    vi.mocked(readJson).mockImplementation(async () => ({
      records: Array.from({ length: 100 }, (_, index) =>
        record(`${page}-${index}`),
      ),
      cursor: String(++page),
    }));
    await expect(
      runActor(
        createActor(recordsMachine, {
          input: { pds, ownerDid: config.ownerDid },
        }),
        signal(),
      ),
    ).rejects.toThrow("Archive size limit");
    expect(readJson).toHaveBeenCalledTimes(101);
  });

  it("validates ownership even for another publication", async () => {
    const wrong = record("one");
    wrong.uri = "at://did:plc:someoneelse/site.standard.document/one";
    wrong.value.site = "https://other.example";
    vi.mocked(readJson).mockResolvedValue({ records: [wrong] });
    await expect(
      runActor(
        createActor(recordsMachine, {
          input: { pds, ownerDid: config.ownerDid },
        }),
        signal(),
      ),
    ).rejects.toThrow("Document owner or collection mismatch");
  });
});

describe("article loading machines", () => {
  it("hydrates inline pages without network work", async () => {
    const actor = createActor(articleMachine, {
      input: { config, pds, record: record("one") },
    });
    const states: unknown[] = [];
    actor.subscribe((state) => states.push(state.value));
    expect((await runActor(actor, signal())).document.content).toMatchObject({
      pages,
    });
    expect(states).toEqual(["preparing", "hydratingPages", "complete"]);
    expect(readJson).not.toHaveBeenCalled();
  });

  it("exposes blob fetching before hydration and prefers it to inline pages", async () => {
    vi.mocked(readJson).mockResolvedValue(pages);
    const actor = createActor(articleMachine, {
      input: {
        config,
        pds,
        record: record("one", {
          $type: "pub.leaflet.content",
          pages: [],
          blobPages: blob,
        }),
      },
    });
    const states: unknown[] = [];
    actor.subscribe((state) => states.push(state.value));
    expect((await runActor(actor, signal())).document.content).toMatchObject({
      pages,
    });
    expect(states).toEqual([
      "preparing",
      "fetchingPages",
      "hydratingPages",
      "complete",
    ]);
  });

  it("passes other content formats through unchanged", async () => {
    const content = { $type: "blog.pckt.content", body: "Fixture" };
    const result = await runActor(
      createActor(articleMachine, {
        input: { config, pds, record: record("one", content) },
      }),
      signal(),
    );
    expect(result.document.content).toEqual(content);
    expect(readJson).not.toHaveBeenCalled();
  });

  it("fails invalid blob pages rather than returning the inline stub", async () => {
    vi.mocked(readJson).mockResolvedValue([]);
    await expect(
      runActor(
        createActor(articleMachine, {
          input: {
            config,
            pds,
            record: record("one", {
              $type: "pub.leaflet.content",
              pages,
              blobPages: blob,
            }),
          },
        }),
        signal(),
      ),
    ).rejects.toThrow();
  });

  it("cancels an active blob child without starting the next article", async () => {
    const entered = Promise.withResolvers<void>();
    let active: AbortSignal | undefined;
    vi.mocked(readJson).mockImplementation(async (_, signal) => {
      active = signal;
      entered.resolve();
      return new Promise(() => {});
    });
    const controller = new AbortController();
    const pending = runActor(
      createActor(articlesMachine, {
        input: {
          config,
          pds,
          records: [
            record("one", { $type: "pub.leaflet.content", blobPages: blob }),
            record("two", { $type: "pub.leaflet.content", blobPages: blob }),
          ],
        },
      }),
      controller.signal,
    );
    const reason = new Error("Cancelled article scan");
    const rejected = expect(pending).rejects.toBe(reason);
    await entered.promise;
    controller.abort(reason);
    await rejected;
    expect(active?.aborted).toBe(true);
    expect(readJson).toHaveBeenCalledOnce();
  });

  it("handles a full inventory belonging to other publications", async () => {
    const other = record("other");
    other.value.site = "https://other.example";
    const result = await runActor(
      createActor(articlesMachine, {
        input: {
          config,
          pds,
          records: Array.from({ length: 10_000 }, (_, index) => ({
            ...other,
            uri: `${other.uri}-${index}`,
          })),
        },
      }),
      signal(),
    );
    expect(result).toEqual([]);
    expect(readJson).not.toHaveBeenCalled();
  });

  it("filters other publications and sorts date ties by identity", async () => {
    const other = record("other", {
      $type: "pub.leaflet.content",
      blobPages: blob,
    });
    other.value.site = "https://other.example";
    const newer = record("newer");
    newer.value.publishedAt = "2024-01-01T00:00:00Z";
    const result = await runActor(
      createActor(articlesMachine, {
        input: {
          config,
          pds,
          records: [record("z"), other, record("a"), newer],
        },
      }),
      signal(),
    );
    expect(result.map((article) => article.key)).toEqual(["newer", "a", "z"]);
    expect(readJson).not.toHaveBeenCalled();
  });
});
