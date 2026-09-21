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
  const notRead = summary?.notRead ?? (file?.decision === "notRead" ? 1 : 0);
  const disagreed =
    summary?.disagreed ?? (file?.decision === "disagree" ? 1 : 0);
  const done = viewed + unread + notRead === total;
  const label = summary
    ? `${viewed} vistos, ${unread} aprovados sem ler, ${total - viewed - unread - notRead} pendentes${notRead ? ` · ${notRead} não lidos` : ""}${disagreed ? ` · ${disagreed} discordâncias` : ""}${viewed === total && !disagreed ? " · Pasta vista" : done ? (disagreed ? " · Pasta concluída com discordâncias" : " · Pasta concluída com arquivos não lidos") : ""}`
    : file?.decision === "agree"
      ? "Concordo"
      : file?.decision === "disagree"
        ? "Discordo"
        : file?.decision === "notRead"
          ? "Não li"
          : viewed
            ? "Revisado"
            : unread
              ? "Aprovado sem ler"
              : "Pendente";
  return (
    <span
      className={`file-state ${disagreed ? "disagreed" : done ? (unread || notRead ? "approved-unread" : "done") : ""}`}
      aria-label={label}
      title={label}
    >
      {disagreed && done
        ? "!"
        : done
          ? unread || notRead
            ? "≈✓"
            : "✓"
          : summary
            ? `${viewed + unread + notRead}/${total}`
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
  decisionsOnly = false,
}: {
  target: ReviewContextTarget;
  count: number;
  viewable: number;
  close: () => void;
  choose: (decision: ReviewDecision) => void;
  decisionsOnly?: boolean;
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
      {(
        [
          ["agree", "Concordo"],
          ["disagree", "Discordo"],
          ["notRead", "Não li"],
        ] as const
      ).map(([decision, label]) => (
        <button
          key={decision}
          role="menuitem"
          disabled={!count || (decision !== "notRead" && !viewable)}
          onClick={() => {
            choose(decision);
            finish();
          }}
        >
          {label}
          {target.folder
            ? ` (${decision === "notRead" ? count : viewable})`
            : ""}
        </button>
      ))}
      {!decisionsOnly && (
        <>
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
        </>
      )}
      {viewable < count && (
        <p>
          Concordar, discordar e marcar como visto se aplicam apenas aos diffs
          disponíveis.
        </p>
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
