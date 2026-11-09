import { describe, expect, it } from "vitest";
import { normalizePages, textRuns, safeLink } from "../src/lib/leaflet/content";
import { PublicationReader } from "../src/lib/server/leaflet/reader";
import { publicAddress, readJson } from "../src/lib/server/leaflet/http";

const did = "did:plc:testowner";
const publication = `at://${did}/site.standard.publication/test`;
const text = (plaintext: string) => ({
  block: { $type: "pub.leaflet.blocks.text", plaintext },
});
const page = (blocks: unknown[]) => ({
  $type: "pub.leaflet.pages.linearDocument",
  id: "root",
  blocks,
});
const document = (key: string, site = publication) => ({
  uri: `at://${did}/site.standard.document/${key}`,
  cid: "testcid",
  value: {
    $type: "site.standard.document",
    site,
    title: key,
    publishedAt: "2023-01-01T00:00:00Z",
    content: {
      $type: "pub.leaflet.content",
      pages: [page([text("Original text")])],
    },
  },
});
function harness() {
  let now = 0;
  let fail = false;
  let changing = false;
  let malformed = false;
  let commitCount = 0;
  let records: unknown[] = [
    document("one"),
    document("unrelated", `at://${did}/site.standard.publication/other`),
  ];
  const calls: string[] = [];
  const reader = new PublicationReader(
    { ownerDid: did, publicationUri: publication },
    {
      now: () => now,
      json: async (input: string) => {
        calls.push(input);
        if (fail) throw new Error("network failure");
        const url = new URL(input);
        if (url.hostname === "plc.directory")
          return {
            id: did,
            service: [
              { id: "#atproto_pds", serviceEndpoint: "https://pds.example" },
            ],
          };
        if (url.pathname.endsWith("getLatestCommit"))
          return {
            cid: changing ? `commit${commitCount++}` : "commit",
            rev: "rev",
          };
        if (url.pathname.endsWith("getRecord"))
          return {
            uri: publication,
            value: {
              $type: "site.standard.publication",
              name: "Test publication",
              url: "https://test.leaflet.pub",
            },
          };
        if (url.pathname.endsWith("getBlob"))
          return [page([text("Blob body")])];
        if (url.searchParams.has("cursor")) return { records: [] };
        return {
          records: malformed
            ? [{ ...document("one"), value: { site: publication } }]
            : records,
          cursor: "next",
        }; // deliberately short page with a cursor
      },
    },
  );
  return {
    reader,
    calls,
    time: (n: number) => {
      now = n;
    },
    fail: () => {
      fail = true;
    },
    remove: () => {
      records = [];
    },
    change: () => {
      changing = true;
    },
    malformed: () => {
      malformed = true;
    },
    records: (value: unknown[]) => {
      records = value;
    },
  };
}

describe("native record reads", () => {
  it("loads complete cursor pages and excludes another publication", async () => {
    const h = harness();
    const result = await h.reader.read();
    expect(result?.articles.map((a) => a.key)).toEqual(["one"]);
    expect(h.calls.some((url) => url.includes("cursor=next"))).toBe(true);
  });
  it("does not load sample content when unconfigured", async () => {
    const reader = new PublicationReader(
      { ownerDid: did },
      {
        json: async () => {
          throw new Error("must not fetch");
        },
      },
    );
    expect(await reader.read()).toBeNull();
  });
  it("rejects publication owner mismatch", () => {
    expect(
      () =>
        new PublicationReader({
          ownerDid: "did:plc:someoneelse",
          publicationUri: publication,
        }),
    ).toThrow();
  });
  it("retains a successful snapshot on error without resetting its age", async () => {
    const h = harness();
    await h.reader.read();
    h.time(301_000);
    h.fail();
    expect((await h.reader.read())?.stale).toBe(true);
    h.time(86_400_000);
    expect((await h.reader.read())?.stale).toBe(true);
    h.time(86_400_001);
    await expect(h.reader.read()).rejects.toThrow();
  });
  it("replaces removed articles after a complete successful refresh", async () => {
    const h = harness();
    await h.reader.read();
    h.time(301_000);
    h.remove();
    expect((await h.reader.read())?.articles).toEqual([]);
  });
  it("does not label a failed first fetch as an empty publication", async () => {
    const h = harness();
    h.fail();
    await expect(h.reader.read()).rejects.toThrow("network failure");
  });
  it("coalesces concurrent archive requests", async () => {
    const h = harness();
    await Promise.all([h.reader.read(), h.reader.read()]);
    expect(h.calls.filter((url) => url.includes("listRecords"))).toHaveLength(
      2,
    );
  });
  it("retains the previous body if the repository changes during a scan", async () => {
    const h = harness();
    await h.reader.read();
    h.time(301_000);
    h.remove();
    h.change();
    expect((await h.reader.read())?.articles.map((a) => a.key)).toEqual([
      "one",
    ]);
  });
  it("does not treat a malformed owned article as a deletion", async () => {
    const h = harness();
    await h.reader.read();
    h.time(301_000);
    h.malformed();
    expect((await h.reader.read())?.articles.map((a) => a.key)).toEqual([
      "one",
    ]);
  });
  it("rejects a missing site before filtering and retains the previous archive", async () => {
    const h = harness();
    await h.reader.read();
    h.time(301_000);
    h.records([{ ...document("one"), value: { title: "Broken record" } }]);
    const result = await h.reader.read();
    expect(result?.stale).toBe(true);
    expect(result?.articles.map((article) => article.key)).toEqual(["one"]);
  });
  it("rejects malformed envelopes instead of publishing an empty first scan", async () => {
    const h = harness();
    h.records([null]);
    await expect(h.reader.read()).rejects.toThrow();
  });
  it("rejects invalid publication references instead of inferring deletion", async () => {
    const h = harness();
    await h.reader.read();
    h.time(301_000);
    h.records([document("one", "not a publication URI")]);
    expect(
      (await h.reader.read())?.articles.map((article) => article.key),
    ).toEqual(["one"]);
  });
  it("settles in-flight requests when disposed and rejects later reads", async () => {
    let signal: AbortSignal | undefined;
    const reader = new PublicationReader(
      { ownerDid: did, publicationUri: publication },
      {
        json: async (_, value) => {
          signal = value;
          return new Promise(() => {});
        },
      },
    );
    const first = reader.read(),
      second = reader.read();
    reader.stop();
    reader.stop();
    await expect(first).rejects.toThrow("stopped");
    await expect(second).rejects.toThrow("stopped");
    await expect(reader.read()).rejects.toThrow("stopped");
    expect(signal?.aborted).toBe(true);
  });
  it("loads blob-backed pages instead of the inline stub", async () => {
    const h = harness(),
      record = document("blob");
    h.records([
      {
        ...record,
        value: {
          ...record.value,
          content: {
            ...record.value.content,
            blobPages: {
              ref: { $link: "bafkreiaaaaaaaaaaaaaaaaaaaaa" },
              mimeType: "application/json",
              size: 100,
            },
          },
        },
      },
    ]);
    const snapshot = await h.reader.read();
    expect(JSON.stringify(snapshot?.articles[0].pages)).toContain("Blob body");
    expect(JSON.stringify(snapshot?.articles[0].pages)).not.toContain(
      "Original text",
    );
  });
});

describe("native content boundary", () => {
  it("uses UTF-8 byte offsets for emoji and preserves overlapping marks", () => {
    const runs = textRuns({
      plaintext: "😀Hello",
      facets: [
        {
          index: { byteStart: 4, byteEnd: 9 },
          features: [{ $type: "pub.leaflet.richtext.facet#bold" }],
        },
        {
          index: { byteStart: 4, byteEnd: 6 },
          features: [{ $type: "pub.leaflet.richtext.facet#italic" }],
        },
      ],
    });
    expect(runs.map((r) => r.text).join("")).toBe("😀Hello");
    expect(runs[1]).toMatchObject({ text: "He", bold: true, italic: true });
  });
  it("rejects unsafe links and malformed byte ranges", () => {
    expect(safeLink("javascript:alert(1)")).toBeUndefined();
    expect(safeLink("https://example.com/")).toBe("https://example.com/");
    expect(
      textRuns({
        plaintext: "😀",
        facets: [
          {
            index: { byteStart: 1, byteEnd: 2 },
            features: [{ $type: "x#bold" }],
          },
        ],
      }),
    ).toEqual([{ text: "😀" }]);
  });
  it("does not expose blocks or unlinked pages beyond a member delimiter", () => {
    const pages = normalizePages(
      [
        page([
          text("Public"),
          { block: { $type: "pub.leaflet.blocks.membersOnlyDelimiter" } },
          text("Private"),
        ]),
        { ...page([text("Secret page")]), id: "secret" },
      ],
      { did, pds: "https://pds.example" },
    );
    expect(JSON.stringify(pages)).toContain("Public");
    expect(JSON.stringify(pages)).not.toMatch(/Private|Secret page/);
  });
  it("uses a fallback for unknown blocks, without injecting HTML or iframes", () => {
    const pages = normalizePages(
      [
        page([
          {
            block: {
              $type: "pub.leaflet.blocks.iframe",
              url: "https://example.com",
            },
          },
        ]),
      ],
      { did, pds: "https://pds.example" },
    );
    expect(pages[0].blocks).toEqual([{ kind: "fallback" }]);
  });
  it("retains a visible source fallback for unsupported annotations", () => {
    const pages = normalizePages(
      [
        page([
          {
            block: {
              $type: "pub.leaflet.blocks.text",
              plaintext: "Footnote",
              facets: [
                {
                  features: [{ $type: "pub.leaflet.richtext.facet#footnote" }],
                },
              ],
            },
          },
        ]),
      ],
      { did, pds: "https://pds.example" },
    );
    expect(pages[0].blocks.at(-1)).toEqual({ kind: "fallback" });
  });
  it("renders only reachable subpages and terminates cycles", () => {
    const pages = normalizePages(
      [
        page([{ block: { $type: "pub.leaflet.blocks.page", id: "child" } }]),
        {
          ...page([
            text("Child"),
            { block: { $type: "pub.leaflet.blocks.page", id: "root" } },
          ]),
          id: "child",
        },
        { ...page([text("Unlinked")]), id: "unlinked" },
      ],
      { did, pds: "https://pds.example" },
    );
    expect(pages.map((p) => p.id)).toEqual(["root", "child"]);
    expect(JSON.stringify(pages)).not.toContain("Unlinked");
  });
  it("does not allow local or private upstream addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "169.254.169.254",
      "192.168.1.1",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "2001:db8::1",
    ])
      expect(publicAddress(ip)).toBe(false);
    expect(publicAddress("8.8.8.8")).toBe(true);
  });
  it("honors cancellation before any transport work", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Cancelled"));
    await expect(
      readJson("https://example.com", undefined, controller.signal),
    ).rejects.toThrow("Cancelled");
  });
});
