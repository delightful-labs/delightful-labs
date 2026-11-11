import type { Snapshot } from "../../src/lib/server/leaflet/model";
import type { StoredSnapshot } from "../../src/lib/server/leaflet/model";
export interface SnapshotStore {
  read(signal: AbortSignal): Promise<StoredSnapshot | null>;
  write(
    snapshot: Snapshot,
    version: string | null,
    signal: AbortSignal,
  ): Promise<boolean>;
}
export const config = {
  ownerDid: "did:plc:testowner",
  publicationUri: "at://did:plc:testowner/site.standard.publication/test",
  publicationKey: "test",
};
export const snapshot = (verifiedAt: number, keys = ["one"]): Snapshot => ({
  publication: {
    uri: config.publicationUri,
    name: "Fixture",
    sourceUrl: "https://example.leaflet.pub",
  },
  articles: keys.map((key) => ({
    uri: `at://${config.ownerDid}/site.standard.document/${key}`,
    cid: "cid",
    key,
    title: key,
    description: "",
    publishedAt: "2023-01-01T00:00:00Z",
    path: `/open-thoughts/${key}/`,
    sourceUrl: "https://leaflet.pub/lish/fixture",
    document: {
      content: { $type: "pub.leaflet.content", pages: [] },
      authorDid: config.ownerDid,
    },
    pds: "https://pds.example",
  })),
  verifiedAt,
  stale: false,
});
export class MemorySnapshotStore implements SnapshotStore {
  current: StoredSnapshot | null;
  failure: Error | undefined;
  private revision = 1;
  constructor(value: Snapshot | null = null) {
    this.current = value
      ? { snapshot: structuredClone(value), version: "1" }
      : null;
  }
  async read(signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.failure) throw this.failure;
    return structuredClone(this.current);
  }
  async write(value: Snapshot, version: string | null, signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.failure) throw this.failure;
    if ((this.current?.version ?? null) !== version) return false;
    this.current = {
      snapshot: structuredClone(value),
      version: String(++this.revision),
    };
    return true;
  }
}
