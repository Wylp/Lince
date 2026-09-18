import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { FileProgress, ReviewDecision, ReviewSummary } from "./model";
export type ReviewContextHandler = (
  event: React.MouseEvent | React.KeyboardEvent,
  path: string,
  folder: boolean,
) => void;
export interface ReviewContextTarget {
  path: string;
  folder: boolean;
  x: number;
  y: number;
  source: HTMLElement;
}
export function ReviewBadge({
  file,
  summary,
}: {
  file?: FileProgress;
  summary?: ReviewSummary;
}) {
  const total = summary?.total ?? (file ? 1 : 0);
  if (!total) return null;
  const viewed = summary?.viewed ?? (file?.reviewed ? 1 : 0);
  const unread = summary?.approvedUnread ?? (file?.approvedUnread ? 1 : 0);
  const done = viewed + unread === total;
  const label = summary
    ? `${viewed} vistos, ${unread} aprovados sem ler, ${total - viewed - unread} pendentes${viewed === total ? " · Pasta vista" : done ? " · Pasta concluída com arquivos não lidos" : ""}`
    : viewed
      ? "Revisado"
      : unread
        ? "Aprovado sem ler"
        : "Pendente";
  return (
    <span
      className={`file-state ${done ? (unread ? "approved-unread" : "done") : ""}`}
      aria-label={label}
      title={label}
    >
      {done
        ? unread
          ? "≈✓"
          : "✓"
        : summary
          ? `${viewed + unread}/${total}`
          : ""}
    </span>
  );
}
export function ReviewContextMenu({
  target,
  count,
  viewable,
  close,
  choose,
}: {
  target: ReviewContextTarget;
  count: number;
  viewable: number;
  close: () => void;
  choose: (decision: ReviewDecision) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = root.current!;
    el.style.left = `${Math.max(8, Math.min(target.x, window.innerWidth - el.offsetWidth - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(target.y, window.innerHeight - el.offsetHeight - 8))}px`;
    el.focus();
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [target]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    const scroll = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", scroll, true);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [close]);
  const finish = () => {
    target.source.focus();
    close();
  };
  return createPortal(
    <div
      className="review-context-menu"
      ref={root}
      role="menu"
      tabIndex={-1}
      aria-label={`Estado de ${target.path}`}
      onKeyDown={(e) => {
        if (e.key === "Escape" || e.key === "Tab") {
          e.preventDefault();
          finish();
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          const items = Array.from(
            root.current!.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          );
          const index = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? items.length - 1
                : (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                  items.length;
          items[next]?.focus();
        }
      }}
    >
      <div className="review-context-title">{target.path}</div>
      <p>
        {target.folder
          ? `${count} arquivos alterados nesta pasta`
          : "Estado local da revisão"}
      </p>
      <button
        role="menuitem"
        disabled={!viewable}
        onClick={() => {
          choose("viewed");
          finish();
        }}
      >
        ✓ Marcar como visto{target.folder ? ` (${viewable})` : ""}
      </button>
      {!target.folder && (
        <button
          role="menuitem"
          disabled={!count}
          onClick={() => {
            choose("approvedUnread");
            finish();
          }}
        >
          ≈✓ Aprovado sem ler
        </button>
      )}
      <button
        role="menuitem"
        disabled={!count}
        onClick={() => {
          choose("pending");
          finish();
        }}
      >
        ○ Marcar como pendente
      </button>
      {viewable < count && (
        <p>Marcar como visto se aplica apenas aos diffs disponíveis.</p>
      )}
      {!count && <p>Apenas arquivos alterados na PR têm estado de revisão.</p>}
    </div>,
    document.body,
  );
}

export function contextKey(
  event: React.KeyboardEvent,
  path: string,
  folder: boolean,
  handler: ReviewContextHandler,
) {
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
    handler(event, path, folder);
}
