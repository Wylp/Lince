export type Format =
  | "bold"
  | "italic"
  | "strike"
  | "heading"
  | "quote"
  | "code"
  | "block"
  | "link"
  | "image"
  | "bullet"
  | "number"
  | "task"
  | "mention"
  | "reference"
  | "table"
  | "suggestion";
export function formatMarkdown(
  text: string,
  start: number,
  end: number,
  format: Format,
) {
  let a = start,
    b = end;
  let selected = text.slice(a, b),
    replacement = "",
    offset = 0,
    length = 0;
  const wrap = (before: string, after: string, fallback: string) => {
    selected ||= fallback;
    replacement = before + selected + after;
    offset = before.length;
    length = selected.length;
  };
  const prefixes: Partial<Record<Format, string>> = {
    heading: "### ",
    quote: "> ",
    bullet: "- ",
    task: "- [ ] ",
  };
  if (prefixes[format] || format === "number") {
    a = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
    const last = text.indexOf("\n", Math.max(start, end - 1));
    b = last < 0 ? text.length : last;
    const lines = text.slice(a, b).split("\n");
    replacement = lines
      .map(
        (line, i) =>
          (format === "number" ? `${i + 1}. ` : prefixes[format]) +
          (line || "Texto"),
      )
      .join("\n");
    length = replacement.length;
  } else if (format === "bold") wrap("**", "**", "texto");
  else if (format === "italic") wrap("_", "_", "texto");
  else if (format === "strike") wrap("~~", "~~", "texto");
  else if (format === "code") {
    const delimiter = "`".repeat(
      Math.max(0, ...[...selected.matchAll(/`+/g)].map((m) => m[0].length)) + 1,
    );
    wrap(delimiter + " ", " " + delimiter, "código");
  } else if (format === "block" || format === "suggestion") {
    const fence = "`".repeat(
      Math.max(2, ...[...selected.matchAll(/`+/g)].map((m) => m[0].length)) + 1,
    );
    wrap(
      (a && text[a - 1] !== "\n" ? "\n" : "") +
        fence +
        (format === "suggestion" ? "suggestion" : "") +
        "\n",
      "\n" + fence + "\n",
      "código",
    );
  } else if (format === "link" || format === "image")
    wrap(
      format === "image" ? "![" : "[",
      "](https://)",
      format === "image" ? "descrição" : "texto do link",
    );
  else if (format === "mention") wrap("@", "", "usuario");
  else if (format === "reference") wrap("#", "", "123");
  else {
    replacement = "\n| Coluna | Valor |\n| --- | --- |\n| Texto | Texto |\n";
    length = replacement.length;
  }
  const value = text.slice(0, a) + replacement + text.slice(b);
  return { value, start: a + offset, end: a + offset + length };
}
