import { z } from "zod";

export const ownerDidSchema = z
  .string()
  .regex(/^did:(plc|web):[A-Za-z0-9.:%_-]+$/);
export const recordKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_~:.-]+$/)
  .refine((key) => key !== "." && key !== "..");
export const httpsUrlSchema = z.url({ protocol: /^https$/ }).refine((value) => {
  const url = URL.parse(value);
  return url !== null && !url.username && !url.password;
});
export const identitySchema = z.object({
  id: z.string(),
  service: z.array(
    z.looseObject({ id: z.string(), serviceEndpoint: z.unknown() }),
  ),
});
export const pdsUrlSchema = httpsUrlSchema.refine((value) => {
  const url = URL.parse(value);
  return (
    url !== null &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash &&
    (!url.port || url.port === "443")
  );
});
export const commitSchema = z.object({
  cid: z.string().min(1),
  rev: z.string().min(1),
});
export const publicationSchema = z.object({
  uri: z.string(),
  value: z.object({
    $type: z.literal("site.standard.publication"),
    name: z.string().min(1),
    url: httpsUrlSchema,
  }),
});
// Validate every envelope before filtering. A malformed row cannot confirm absence.
export const documentRecordSchema = z.object({
  uri: z.string().min(1),
  cid: z.string().min(1),
  value: z.looseObject({
    $type: z.literal("site.standard.document"),
    site: z.union([
      httpsUrlSchema,
      z
        .string()
        .regex(
          /^at:\/\/[^/?#\s]+\/[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+){2,}\/[A-Za-z0-9_~:.-]+$/,
        ),
    ]),
  }),
});
export const recordPageSchema = z.object({
  records: z.array(documentRecordSchema).max(100),
  cursor: z.string().optional(),
});
export const articleMetadataSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  publishedAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }).optional(),
});
export const pageBlobSchema = z.object({
  ref: z.object({ $link: z.string().regex(/^b[a-z2-7]{10,}$/) }),
  mimeType: z.literal("application/json"),
  size: z.number().int().nonnegative().max(5_000_000),
});
export const contentSchema = z.object({
  $type: z.literal("pub.leaflet.content"),
  pages: z.array(z.unknown()).max(1000).optional(),
  blobPages: pageBlobSchema.nullish(),
});
export const pagesSchema = z.array(z.unknown()).min(1).max(1000);
export type DocumentRecord = z.infer<typeof documentRecordSchema>;
