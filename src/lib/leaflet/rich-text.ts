import { array, object, string, type ObjectValue } from "./values";
import { safeLink } from "./links";
import type { TextRun } from "./model";

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
