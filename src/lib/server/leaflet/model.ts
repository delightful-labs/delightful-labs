import type { StandardSiteDocument } from "@standard-reader/renderer-core";

export type ReaderConfig = { ownerDid: string; publicationUri?: string };
export type ConfiguredReader = {
  ownerDid: string;
  publicationUri: string;
  publicationKey: string;
};
export type JsonReader = (
  url: string,
  signal?: AbortSignal,
) => Promise<unknown>;
export const CACHE_FRESH_MS = 300_000;
export const CACHE_STALE_MS = 86_400_000;
export type SnapshotStorage = { storeId: string; namespace: string };
export type Article = {
  uri: string;
  cid: string;
  key: string;
  title: string;
  description: string;
  publishedAt: string;
  updatedAt?: string;
  path: string;
  sourceUrl: string;
  document: StandardSiteDocument;
  pds: string;
};
export type Snapshot = {
  publication: { uri: string; name: string; sourceUrl: string };
  articles: Article[];
  verifiedAt: number;
  stale: boolean;
};

export type StoredSnapshot = { snapshot: Snapshot; version: string };
