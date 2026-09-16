import { describe, expect, it } from "vitest";
import { parseDiff } from "react-diff-view";
import { reconcile } from "./model";
import type { Snapshot } from "./model";
const snapshot = {
  files: [
    { path: "a.ts", version: "new" },
    { path: "b.ts", version: "same" },
  ],
} as Snapshot;
describe("review reconciliation", () => {
  it("invalidates changed files while preserving unchanged progress and selection", () => {
    const { review, invalidated } = reconcile(snapshot, {
      selected: "b.ts",
      files: {
        "a.ts": { version: "old", reviewed: true, top: 800, left: 20 },
        "b.ts": { version: "same", reviewed: true, top: 450, left: 30 },
      },
    });
    expect(invalidated).toBe(1);
    expect(review.files["a.ts"].reviewed).toBe(false);
    expect(review.files["a.ts"].top).toBe(0);
    expect(review.files["b.ts"].top).toBe(450);
    expect(review.selected).toBe("b.ts");
  });
  it("drops deleted paths and handles an empty PR", () => {
    expect(reconcile({ files: [] } as unknown as Snapshot).review).toEqual({
      files: {},
      selected: "",
    });
    expect(
      reconcile(snapshot, { selected: "gone", files: {} }).review.selected,
    ).toBe("a.ts");
  });
});
describe("diff library evaluation", () => {
  it.each([
    ["added", "@@ -0,0 +1,2 @@\n+one\n+two\n", 0, 2],
    ["removed", "@@ -1,2 +0,0 @@\n-one\n-two\n", 2, 0],
    ["modified / renamed content", "@@ -1 +1 @@\n-old\n+new\n", 1, 1],
    [
      "no newline",
      "@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n",
      1,
      1,
    ],
  ])("parses %s without losing changes", (_, patch, removed, added) => {
    const parsed = parseDiff(
      `diff --git a/file b/file\n--- a/file\n+++ b/file\n${patch}`,
    );
    expect(parsed).toHaveLength(1);
    const changes = parsed[0].hunks.flatMap((h) => h.changes);
    expect(changes.filter((c) => c.type === "insert")).toHaveLength(
      added as number,
    );
    expect(changes.filter((c) => c.type === "delete")).toHaveLength(
      removed as number,
    );
  });
});
