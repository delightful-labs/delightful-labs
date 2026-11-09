import { array, blockType, object, string } from "./values";
import { createBlockNormalizer } from "./blocks";
import type { Block, ContentContext, Page } from "./model";

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
  const pageIndex = new Map(
    rawPages.map((p, i) => [string(p.id) || `page-${i}`, i]),
  );
  const normalize = createBlockNormalizer(context, (id) => {
    const index = pageIndex.get(id);
    if (index === undefined) return false;
    pending.push(index);
    return true;
  });
  while (pending.length) {
    const index = pending.shift()!;
    if (seen.has(index)) continue;
    seen.add(index);
    const page = rawPages[index],
      blocks: Block[] = [];
    if (blockType(page) !== "linearDocument") blocks.push({ kind: "fallback" });
    else
      for (const wrapper of array(page.blocks)) {
        const block = object(object(wrapper).block);
        if (blockType(block) === "membersOnlyDelimiter") {
          blocks.push({ kind: "fallback" });
          break;
        }
        blocks.push(...normalize(block));
      }
    result.push({ id: string(page.id) || `page-${index}`, blocks });
  }
  return result;
}
