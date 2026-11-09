import type { Rpc } from "./client";
import { parseDocumentKey } from "./config";
import { recordPageSchema, type DocumentRecord } from "./schemas";

export async function readDocumentRecords(
  rpc: Rpc,
  did: string,
): Promise<DocumentRecord[]> {
  const records: DocumentRecord[] = [],
    cursors = new Set<string>(),
    seen = new Set<string>();
  let cursor = "";
  do {
    const response = recordPageSchema.parse(
      await rpc("com.atproto.repo.listRecords", {
        repo: did,
        collection: "site.standard.document",
        limit: "100",
        ...(cursor ? { cursor } : {}),
      }),
    );
    for (const record of response.records) {
      parseDocumentKey(record.uri, did);
      if (seen.has(record.uri)) throw new Error("Duplicate record identity");
      seen.add(record.uri);
      records.push(record);
    }
    if (records.length > 10_000) throw new Error("Archive size limit");
    cursor = response.cursor ?? "";
    if (cursor && cursors.has(cursor)) throw new Error("Repeated cursor");
    if (cursor) cursors.add(cursor);
    if (cursors.size > 200) throw new Error("Pagination limit");
  } while (cursor);
  return records;
}
