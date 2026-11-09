import { Feed } from "feed";
import { render } from "svelte/server";
import LeafletDocument from "../../components/LeafletDocument.svelte";
import type { Snapshot } from "../leaflet/model";
import { archivedPost } from "./archive";

import type { FeedFormat } from "../../leaflet/feed";
export { feedFormats, type FeedFormat } from "../../leaflet/feed";

export function publicationFeed(
  snapshot: Snapshot,
  origin: string,
  format: FeedFormat,
): string {
  const url = `${origin}/open-thoughts/`;
  const articles = [...snapshot.articles].sort(
    (a, b) =>
      Date.parse(b.publishedAt) - Date.parse(a.publishedAt) ||
      a.uri.localeCompare(b.uri),
  );
  const updated = new Date(
    Math.max(
      0,
      ...articles.map((article) =>
        Date.parse(article.updatedAt ?? article.publishedAt),
      ),
    ),
  );
  const feed = new Feed({
    title: snapshot.publication.name,
    id: snapshot.publication.uri,
    link: url,
    language: "en",
    copyright: "",
    updated,
    author: {
      name: "Matt Derocher",
      link: "https://bsky.app/profile/derocher.me",
    },
    feedLinks: {
      atom: url + "atom.xml",
      rss: url + "rss.xml",
      json: url + "feed.json",
    },
  });
  for (const article of articles) {
    const content = render(LeafletDocument, {
      props: {
        document: article.document,
        pds: article.pds,
        sourceUrl: article.sourceUrl,
        unstyled: true,
      },
    }).body.replace(/<!--[\s\S]*?-->/g, "");
    // Atom HTML titles must treat source metadata as text.
    const atomTitle = article.title.replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char]!,
    );
    feed.addItem({
      title: format === "atom.xml" ? atomTitle : article.title,
      id: archivedPost(article.uri)?.atomId ?? article.uri,
      link: `${origin}${article.path}`,
      description: article.description || undefined,
      content,
      published: new Date(article.publishedAt),
      date: new Date(article.updatedAt ?? article.publishedAt),
    });
  }
  return format === "atom.xml"
    ? feed.atom1()
    : format === "rss.xml"
      ? feed.rss2()
      : feed.json1();
}
