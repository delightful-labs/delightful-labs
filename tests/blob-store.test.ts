import { randomUUID } from "node:crypto";
import {
  BlobPreconditionFailedError,
  get,
  put,
  type GetBlobResult,
} from "@vercel/blob";
import { Headers } from "undici";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  blobSnapshotStore,
  snapshotPath,
} from "../src/lib/server/leaflet/blob-store";
import { config, snapshot } from "./fixtures/snapshots";
vi.mock("@vercel/blob", async (original) => ({
  ...(await original<typeof import("@vercel/blob")>()),
  get: vi.fn(),
  put: vi.fn(),
}));
const signal = () => new AbortController().signal;
const namespace = "preview/fixture";
const store = () => blobSnapshotStore(config, "store_fixture", namespace);
function envelope() {
  return {
    schemaVersion: 1,
    ownerDid: config.ownerDid,
    publicationUri: config.publicationUri,
    namespace,
    revision: randomUUID(),
    snapshot: snapshot(100),
  };
}
function response(value: unknown): GetBlobResult {
  const body = JSON.stringify(value);
  return {
    statusCode: 200,
    stream: new Response(body).body!,
    headers: new Headers(),
    blob: {
      url: "https://fixture.private.blob.vercel-storage.com/snapshot.json",
      downloadUrl:
        "https://fixture.private.blob.vercel-storage.com/snapshot.json",
      pathname: "snapshot.json",
      contentDisposition: "inline",
      contentType: "application/json",
      cacheControl: "max-age=60",
      uploadedAt: new Date(100),
      size: Buffer.byteLength(body),
      etag: '"version-1"',
    },
  };
}
beforeEach(() => vi.resetAllMocks());

describe("private Blob snapshot adapter", () => {
  it("reads the latest private object and preserves its CAS version", async () => {
    vi.mocked(get).mockResolvedValue(response(envelope()));
    expect(await store().read(signal())).toEqual({
      snapshot: snapshot(100),
      version: '"version-1"',
    });
    expect(get).toHaveBeenCalledWith(
      snapshotPath(config, namespace),
      expect.objectContaining({
        access: "private",
        useCache: false,
        storeId: "store_fixture",
        abortSignal: expect.any(AbortSignal),
      }),
    );
  });

  it("distinguishes absent storage data from a failed read", async () => {
    vi.mocked(get)
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("offline"));
    expect(await store().read(signal())).toBeNull();
    await expect(store().read(signal())).rejects.toThrow("offline");
  });

  it.each([
    "owner",
    "publication",
    "namespace",
    "version",
    "article",
    "duplicate",
  ])("rejects a snapshot with invalid %s", async (change) => {
    const value = envelope();
    if (change === "owner") value.ownerDid = "did:plc:another";
    if (change === "publication") value.snapshot.publication.uri += "-other";
    if (change === "namespace") value.namespace = "production";
    if (change === "version") value.schemaVersion = 2;
    if (change === "article") value.snapshot.articles[0].path = "/unrelated/";
    if (change === "duplicate")
      value.snapshot.articles.push(value.snapshot.articles[0]);
    vi.mocked(get).mockResolvedValue(response(value));
    await expect(store().read(signal())).rejects.toThrow();
  });

  it("enforces a read size bound before parsing", async () => {
    vi.mocked(get).mockResolvedValue(
      response({ large: " ".repeat(10_000_001) }),
    );
    await expect(store().read(signal())).rejects.toThrow("size limit");
  });

  it("creates without overwrite and replaces only the supplied version", async () => {
    vi.mocked(put).mockResolvedValue({
      url: "https://fixture.private.blob.vercel-storage.com/snapshot.json",
      downloadUrl:
        "https://fixture.private.blob.vercel-storage.com/snapshot.json",
      pathname: "snapshot.json",
      contentType: "application/json",
      contentDisposition: "inline",
      etag: "next",
    });
    expect(await store().write(snapshot(100), null, signal())).toBe(true);
    const first = vi.mocked(put).mock.calls[0];
    expect(first[2]).toMatchObject({
      access: "private",
      allowOverwrite: false,
      addRandomSuffix: false,
    });
    expect(first[2]).not.toHaveProperty("ifMatch");
    expect(await store().write(snapshot(100), '"version-1"', signal())).toBe(
      true,
    );
    const next = vi.mocked(put).mock.calls[1];
    expect(next[2]).toMatchObject({
      allowOverwrite: true,
      ifMatch: '"version-1"',
    });
    expect(JSON.parse(String(first[1])).revision).not.toBe(
      JSON.parse(String(next[1])).revision,
    );
  });

  it("returns a conflict when a CAS precondition fails", async () => {
    vi.mocked(put).mockRejectedValue(new BlobPreconditionFailedError());
    expect(await store().write(snapshot(100), "old-version", signal())).toBe(
      false,
    );
  });

  it("recognizes a first-writer race using an authoritative read", async () => {
    vi.mocked(put).mockRejectedValue(new Error("already exists"));
    vi.mocked(get).mockResolvedValue(response(envelope()));
    expect(await store().write(snapshot(100), null, signal())).toBe(false);
  });

  it("does not swallow a failed first write when no snapshot exists", async () => {
    vi.mocked(put).mockRejectedValue(new Error("offline"));
    vi.mocked(get).mockResolvedValue(null);
    await expect(store().write(snapshot(100), null, signal())).rejects.toThrow(
      "offline",
    );
  });

  it("rejects an oversized write before making a request", async () => {
    const value = snapshot(100);
    value.articles[0].description = " ".repeat(10_000_001);
    await expect(store().write(value, null, signal())).rejects.toThrow(
      "size limit",
    );
    expect(put).not.toHaveBeenCalled();
  });

  it("isolates environments, branches and publications while keeping stable deployment keys", () => {
    const path = snapshotPath(config, "preview/main");
    expect(snapshotPath(config, "preview/main")).toBe(path);
    expect(snapshotPath(config, "production")).not.toBe(path);
    expect(snapshotPath(config, "preview/other")).not.toBe(path);
    expect(
      snapshotPath(
        { ...config, publicationUri: config.publicationUri + "-other" },
        "preview/main",
      ),
    ).not.toBe(path);
  });

  it("honors an already-aborted caller before storage work", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(store().read(controller.signal)).rejects.toThrow("cancelled");
    await expect(
      store().write(snapshot(100), null, controller.signal),
    ).rejects.toThrow("cancelled");
    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});
