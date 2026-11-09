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
export type ReaderDependencies = { json?: JsonReader; now?: () => number };
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
export type SnapshotLoader = (signal: AbortSignal) => Promise<Snapshot>;
