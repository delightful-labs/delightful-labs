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
