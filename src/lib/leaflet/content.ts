export type ObjectValue = Record<string, unknown>;
export const object = (v: unknown): ObjectValue =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as ObjectValue)
    : {};
export const string = (v: unknown): string => (typeof v === "string" ? v : "");
export const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const type = (v: ObjectValue) => string(v.$type).split(".").at(-1);
export function safeLink(value: unknown): string | undefined {
  const raw = string(value);
  if (!raw || /[\u0000-\u0020]/u.test(raw)) return;
  try {
    const url = new URL(raw);
    if (
      ["https:", "http:", "mailto:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
      return url.href;
  } catch {
    /* Unsafe or relative targets remain plain text. */
  }
}

export type TextRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  underline?: boolean;
  href?: string;
  id?: string;
};
export function textRuns(block: ObjectValue): TextRun[] {
  const text = string(block.plaintext);
  const bytes = new TextEncoder().encode(text);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const facets: { start: number; end: number; features: ObjectValue[] }[] = [];
  for (const value of array(block.facets).slice(0, 2000)) {
    const facet = object(value),
      index = object(facet.index);
    const start = Number(index.byteStart),
      end = Number(index.byteEnd);
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start ||
      end > bytes.length
    )
      continue;
    try {
      decoder.decode(bytes.slice(0, start));
      decoder.decode(bytes.slice(start, end));
    } catch {
      continue;
    }
    facets.push({ start, end, features: array(facet.features).map(object) });
  }
  const bounds = [
    ...new Set([0, bytes.length, ...facets.flatMap((f) => [f.start, f.end])]),
  ].sort((a, b) => a - b);
  return bounds.slice(0, -1).map((start, i) => {
    const end = bounds[i + 1];
    const run: TextRun = { text: decoder.decode(bytes.slice(start, end)) };
    for (const facet of facets.filter(
      (f) => f.start <= start && f.end >= end,
    )) {
      for (const feature of facet.features) {
        switch (string(feature.$type).split("#").at(-1)) {
          case "bold":
            run.bold = true;
            break;
          case "italic":
            run.italic = true;
            break;
          case "code":
            run.code = true;
            break;
          case "strikethrough":
            run.strike = true;
            break;
          case "underline":
            run.underline = true;
            break;
          case "link":
          case "atMention": {
            const href = safeLink(feature.uri ?? feature.href);
            if (href) run.href = href;
            break;
          }
          case "didMention": {
            const did = string(feature.did);
            if (/^did:(plc|web):[A-Za-z0-9.:%_-]+$/.test(did))
              run.href = `https://bsky.app/profile/${encodeURIComponent(did)}`;
            break;
          }
          case "id":
            if (
              start === facet.start &&
              /^[A-Za-z][\w:.-]*$/.test(string(feature.id))
            )
              run.id = string(feature.id);
            break;
        }
      }
    }
    return run;
  });
}

export type Block =
  | { kind: "text" | "quote"; runs: TextRun[] }
  | {
      kind: "heading";
      runs: TextRun[];
      level: 1 | 2 | 3 | 4 | 5 | 6;
      id: string;
    }
  | { kind: "code"; text: string }
  | { kind: "rule" }
  | { kind: "image"; src: string; alt: string; missingAlt: boolean }
  | {
      kind: "list";
      ordered: boolean;
      start: number;
      items: { blocks: Block[]; checked?: boolean }[];
    }
  | { kind: "link"; href: string; text: string }
  | { kind: "page"; id: string }
  | { kind: "fallback" };
export type Page = { id: string; blocks: Block[] };
export type ContentContext = { did: string; pds: string };
export const pageAnchor = (id: string) => `page-${encodeURIComponent(id)}`;

export function normalizePages(
  values: unknown[],
  context: ContentContext,
): Page[] {
  if (values.length > 1000) throw new Error("Too many content pages");
  const rawPages = values.map(object);
  if (!rawPages.length) return [];
  const ids = rawPages.map((p, i) => string(p.id) || `page-${i}`);
  if (new Set(ids).size !== ids.length)
    throw new Error("Duplicate content page identity");
  const pending = [0],
    seen = new Set<number>(),
    result: Page[] = [];
  let count = 0;
  const pageIndex = new Map(
    rawPages.map((p, i) => [string(p.id) || `page-${i}`, i]),
  );
  function normalize(raw: unknown, depth = 0): Block[] {
    if (++count > 15000 || depth > 20) throw new Error("Content nesting limit");
    const b = object(raw);
    const supportedFacets = new Set([
      "link",
      "atMention",
      "didMention",
      "bold",
      "italic",
      "code",
      "strikethrough",
      "underline",
      "id",
    ]);
    const unsupportedAnnotation = array(b.facets).some((f) =>
      array(object(f).features).some(
        (feature) =>
          !supportedFacets.has(
            string(object(feature).$type).split("#").at(-1) || "",
          ),
      ),
    );
    const annotationFallback: Block[] = unsupportedAnnotation
      ? [{ kind: "fallback" }]
      : [];
    switch (type(b)) {
      case "text":
        return [{ kind: "text", runs: textRuns(b) }, ...annotationFallback];
      case "header": {
        const level = Math.min(
          6,
          Math.max(1, Math.floor(Number(b.level) || 2)),
        ) as 1 | 2 | 3 | 4 | 5 | 6;
        const id = string(b.plaintext)
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s-]/gu, "")
          .trim()
          .replace(/\s+/g, "-");
        return [
          { kind: "heading", level, id, runs: textRuns(b) },
          ...annotationFallback,
        ];
      }
      case "blockquote":
        return [{ kind: "quote", runs: textRuns(b) }, ...annotationFallback];
      case "code":
        return [{ kind: "code", text: string(b.plaintext) }];
      case "horizontalRule":
        return [{ kind: "rule" }];
      case "image": {
        const blob = object(b.image),
          cid = string(object(blob.ref).$link);
        if (
          !/^b[a-z2-7]{10,}$/.test(cid) ||
          ![
            "image/png",
            "image/jpeg",
            "image/webp",
            "image/avif",
            "image/gif",
          ].includes(string(blob.mimeType))
        )
          return [{ kind: "fallback" }];
        const url = new URL("/xrpc/com.atproto.sync.getBlob", context.pds);
        url.searchParams.set("did", context.did);
        url.searchParams.set("cid", cid);
        return [
          {
            kind: "image",
            src: url.href,
            alt: string(b.alt),
            missingAlt: !string(b.alt),
          },
        ];
      }
      case "imageGallery":
        return array(b.images).flatMap((image) =>
          normalize(
            { ...object(image), $type: "pub.leaflet.blocks.image" },
            depth + 1,
          ),
        );
      case "unorderedList":
      case "orderedList": {
        const ordered = type(b) === "orderedList";
        const items = array(b.children).map((value) => {
          const item = object(value);
          const blocks = normalize(item.content, depth + 1);
          if (array(item.children).length)
            blocks.push(
              ...normalize(
                { $type: b.$type, children: item.children },
                depth + 1,
              ),
            );
          else if (ordered && item.unorderedListChildren)
            blocks.push(...normalize(item.unorderedListChildren, depth + 1));
          else if (!ordered && item.orderedListChildren)
            blocks.push(...normalize(item.orderedListChildren, depth + 1));
          return {
            blocks,
            checked:
              typeof item.checked === "boolean" ? item.checked : undefined,
          };
        });
        return [
          {
            kind: "list",
            ordered,
            start: Number.isInteger(b.startIndex) ? Number(b.startIndex) : 1,
            items,
          },
        ];
      }
      case "button":
      case "website": {
        const href = safeLink(b.url ?? b.src);
        return href
          ? [{ kind: "link", href, text: string(b.text ?? b.title) || href }]
          : [{ kind: "fallback" }];
      }
      case "page": {
        const id = string(b.id),
          index = pageIndex.get(id);
        if (index === undefined) return [{ kind: "fallback" }];
        pending.push(index);
        return [{ kind: "page", id }];
      }
      default:
        return [{ kind: "fallback" }];
    }
  }
  while (pending.length) {
    const index = pending.shift()!;
    if (seen.has(index)) continue;
    seen.add(index);
    const page = rawPages[index],
      blocks: Block[] = [];
    if (type(page) !== "linearDocument") blocks.push({ kind: "fallback" });
    else
      for (const wrapper of array(page.blocks)) {
        const block = object(object(wrapper).block);
        if (type(block) === "membersOnlyDelimiter") {
          blocks.push({ kind: "fallback" });
          break;
        }
        blocks.push(...normalize(block));
      }
    result.push({ id: string(page.id) || `page-${index}`, blocks });
  }
  return result;
}
