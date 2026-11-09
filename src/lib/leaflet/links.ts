import { string } from "./values";

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
