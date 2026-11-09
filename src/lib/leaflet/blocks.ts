import { array, blockType, object, string } from "./values";
import { safeLink } from "./links";
import { textRuns } from "./rich-text";
import type { Block, ContentContext } from "./model";

export function createBlockNormalizer(
  context: ContentContext,
  queuePage: (id: string) => boolean,
): (raw: unknown, depth?: number) => Block[] {
  let count = 0;
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
    switch (blockType(b)) {
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
        const ordered = blockType(b) === "orderedList";
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
        const id = string(b.id);
        if (!queuePage(id)) return [{ kind: "fallback" }];
        return [{ kind: "page", id }];
      }
      default:
        return [{ kind: "fallback" }];
    }
  }

  return normalize;
}
