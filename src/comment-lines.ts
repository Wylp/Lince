export interface LineRange {
  startLine: number;
  line: number;
}
export interface CommentRanges {
  LEFT: LineRange[];
  RIGHT: LineRange[];
}
export function commentRanges(patch: string | null | undefined): CommentRanges {
  const ranges: CommentRanges = { LEFT: [], RIGHT: [] };
  for (const match of (patch ?? "").matchAll(
    /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm,
  )) {
    for (const [side, start, count] of [
      ["LEFT", Number(match[1]), Number(match[2] ?? 1)],
      ["RIGHT", Number(match[3]), Number(match[4] ?? 1)],
    ] as const) {
      if (start > 0 && count > 0)
        ranges[side].push({ startLine: start, line: start + count - 1 });
    }
  }
  return ranges;
}
export function selectedLines(selection: {
  startLineNumber: number;
  endLineNumber: number;
  endColumn: number;
}): LineRange {
  return {
    startLine: selection.startLineNumber,
    line:
      selection.endLineNumber -
      (selection.endLineNumber > selection.startLineNumber &&
      selection.endColumn === 1
        ? 1
        : 0),
  };
}
