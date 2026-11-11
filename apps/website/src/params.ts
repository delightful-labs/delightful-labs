import { defineParams } from "@sveltejs/kit/params";
import { feedFormats, type FeedFormat } from "#lib/leaflet/feed.ts";

export const params = defineParams({
  feed: (value: string): FeedFormat | undefined =>
    Object.hasOwn(feedFormats, value) ? (value as FeedFormat) : undefined,
});
