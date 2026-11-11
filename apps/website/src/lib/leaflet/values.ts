export type ObjectValue = Record<string, unknown>;
export const object = (v: unknown): ObjectValue =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as ObjectValue)
    : {};
export const string = (v: unknown): string => (typeof v === "string" ? v : "");
