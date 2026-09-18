import { expect, it } from "vitest";
import { commentRanges, selectedLines } from "./comment-lines";
it("keeps deleted and added line ranges separate and excludes absent sides", () => {
  expect(commentRanges("@@ -0,0 +1,3 @@\n@@ -8,2 +10 @@\n")).toEqual({
    LEFT: [{ startLine: 8, line: 9 }],
    RIGHT: [
      { startLine: 1, line: 3 },
      { startLine: 10, line: 10 },
    ],
  });
  expect(commentRanges(null)).toEqual({ LEFT: [], RIGHT: [] });
});
it("does not comment the following line when a selection ends at column one", () => {
  expect(
    selectedLines({ startLineNumber: 3, endLineNumber: 6, endColumn: 1 }),
  ).toEqual({ startLine: 3, line: 5 });
  expect(
    selectedLines({ startLineNumber: 3, endLineNumber: 6, endColumn: 5 }),
  ).toEqual({ startLine: 3, line: 6 });
});
