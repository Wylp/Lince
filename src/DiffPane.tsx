import { useLayoutEffect, useMemo, useRef } from "react";
import { Diff, Hunk, Decoration, parseDiff } from "react-diff-view";
import type { FileDiff, FileProgress } from "./model";
import "react-diff-view/style/index.css";

export function DiffPane({
  data,
  position,
  onScroll,
}: {
  data: FileDiff;
  position: FileProgress;
  onScroll: (top: number, left: number) => void;
}) {
  const pane = useRef<HTMLDivElement>(null);
  const parsed = useMemo(() => {
    if (!data.patch) return null;
    try {
      return parseDiff(data.patch)[0] ?? null;
    } catch {
      return null;
    }
  }, [data.patch]);
  const width = parsed
    ? Math.max(
        850,
        ...parsed.hunks.flatMap((h) =>
          h.changes.map(
            (c) => (c.content.replace(/\t/g, "    ").length * 7.3 + 75) * 2,
          ),
        ),
      )
    : 850;
  useLayoutEffect(() => {
    if (pane.current) {
      pane.current.scrollTop = position.top;
      pane.current.scrollLeft = position.left;
    }
    // Restore once on mount; the parent keys this pane by snapshot and file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      ref={pane}
      className="diff-scroll"
      data-testid="diff-scroll"
      tabIndex={0}
      aria-label="Diff do arquivo, com rolagem independente"
      onScroll={(e) =>
        onScroll(e.currentTarget.scrollTop, e.currentTarget.scrollLeft)
      }
    >
      {parsed && data.reason && (
        <div className="metadata-note">{data.reason}</div>
      )}
      {parsed ? (
        <div style={{ minWidth: width }}>
          <Diff
            viewType="split"
            diffType={parsed.type}
            hunks={parsed.hunks}
            gutterType="default"
          >
            {(hunks) =>
              hunks.flatMap((hunk) => [
                <Decoration key={`header-${hunk.content}`}>
                  <div className="hunk-label">{hunk.content}</div>
                </Decoration>,
                <Hunk key={hunk.content} hunk={hunk} />,
              ])
            }
          </Diff>
        </div>
      ) : (
        <div className="notice">
          <span className="notice-icon">{data.reviewable ? "◇" : "⊘"}</span>
          <h3>
            {data.reviewable ? "Sem alteração textual" : "Diff indisponível"}
          </h3>
          <p>
            {data.reason ??
              "Não foi possível interpretar este diff. O arquivo não deve ser considerado revisado."}
          </p>
        </div>
      )}
    </div>
  );
}
