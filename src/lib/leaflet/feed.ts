export const feedFormats = {
  "atom.xml": "application/atom+xml; charset=utf-8",
  "rss.xml": "application/rss+xml; charset=utf-8",
  "feed.json": "application/feed+json; charset=utf-8",
} as const;
export type FeedFormat = keyof typeof feedFormats;
