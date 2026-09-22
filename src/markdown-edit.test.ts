import { expect, it } from "vitest";
import { formatMarkdown } from "./markdown-edit";
it("formats only the selected text and keeps the selection inside markup", () => {
  const edit = formatMarkdown("before hello after", 7, 12, "bold");
  expect(edit.value).toBe("before **hello** after");
  expect(edit.value.slice(edit.start, edit.end)).toBe("hello");
});
it("prefixes complete selected lines without changing the next line", () => {
  expect(formatMarkdown("one\ntwo\nthree", 0, 8, "number").value).toBe(
    "1. one\n2. two\nthree",
  );
  expect(formatMarkdown("\nnext", 0, 0, "task").value).toBe(
    "- [ ] Texto\nnext",
  );
});
it("uses a longer fence for code that already contains backticks", () => {
  expect(formatMarkdown("```ts\ncode\n```", 0, 14, "block").value).toBe(
    "````\n```ts\ncode\n```\n````\n",
  );
});
