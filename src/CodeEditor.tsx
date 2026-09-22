import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MarkdownPreview } from "./MarkdownComposer";
import type { DraftComment } from "./ReviewComments";
import { monaco, options } from "./editor";
import { selectedLines } from "./comment-lines";
import type { CommentRanges, LineRange } from "./comment-lines";
export interface EditorHandle {
  editor: monaco.editor.IStandaloneCodeEditor;
  diff?: monaco.editor.IStandaloneDiffEditor;
}
export function CodeEditor({
  model,
  original,
  position,
  onScroll,
  onReady,
  line,
  column = 1,
  commentable,
  onComment,
  draftRanges,
  inlineTarget,
  onCommentHost,
  onEditDraft,
}: {
  model: monaco.editor.ITextModel;
  original?: monaco.editor.ITextModel;
  position?: { top: number; left: number };
  onScroll?: (top: number, left: number) => void;
  onReady?: (handle: EditorHandle) => void;
  line?: number;
  column?: number;
  commentable?: CommentRanges;
  onComment?: (side: "LEFT" | "RIGHT", range: LineRange) => void;
  inlineTarget?: ({ side: "LEFT" | "RIGHT" } & LineRange) | null;
  onCommentHost?: (host: HTMLElement | null) => void;
  draftRanges?: DraftComment[];
  onEditDraft?: (id: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [savedHosts, setSavedHosts] = useState<
    { comment: DraftComment; host: HTMLElement }[]
  >([]);
  const savedKey = JSON.stringify(draftRanges ?? []);
  const callbacks = useRef({
    onScroll,
    onReady,
    onComment,
    commentable,
    inlineTarget,
    onCommentHost,
  });
  callbacks.current = {
    onScroll,
    onReady,
    onComment,
    commentable,
    inlineTarget,
    onCommentHost,
  };
  const editors = useRef<
    { editor: monaco.editor.IStandaloneCodeEditor; side: "LEFT" | "RIGHT" }[]
  >([]);
  const draftDecorations = useRef<monaco.editor.IEditorDecorationsCollection[]>(
    [],
  );
  useEffect(() => {
    const diff = original
      ? monaco.editor.createDiffEditor(root.current!, {
          ...options,
          originalEditable: false,
          glyphMargin: !!onComment,
          renderSideBySide: true,
          enableSplitViewResizing: true,
          hideUnchangedRegions: { enabled: false },
          renderOverviewRuler: false,
          diffAlgorithm: "advanced",
          maxComputationTime: 5000,
          accessibilityVerbose: true,
        })
      : undefined;
    const editor = diff
      ? diff.getModifiedEditor()
      : monaco.editor.create(root.current!, {
          ...options,
          model,
          glyphMargin: !!onComment,
        });
    if (diff) diff.setModel({ original: original!, modified: model });
    let restoring = true;
    const restore = () => {
      editor.setScrollPosition({
        scrollTop: position?.top ?? 0,
        scrollLeft: position?.left ?? 0,
      });
      if (line) {
        editor.setPosition({ lineNumber: line, column });
        editor.revealLineInCenter(line);
      }
      restoring = false;
    };
    restore();
    const computed = diff?.onDidUpdateDiff(() => {
      if (restoring) restore();
    });
    const scroll = editor.onDidScrollChange((e) => {
      if (!restoring && !callbacks.current.inlineTarget)
        callbacks.current.onScroll?.(e.scrollTop, e.scrollLeft);
    });
    let focused = editor;
    const focusListeners = [
      editor,
      ...(diff ? [diff.getOriginalEditor()] : []),
    ].map((ed) =>
      ed.onDidFocusEditorText(() => {
        focused = ed;
      }),
    );
    editors.current = [
      { editor, side: "RIGHT" },
      ...(diff
        ? [{ editor: diff.getOriginalEditor(), side: "LEFT" as const }]
        : []),
    ];
    const commentListeners: monaco.IDisposable[] = [];
    const marginDecorations: monaco.editor.IEditorDecorationsCollection[] = [];
    const releaseHandlers: (() => void)[] = [];
    if (onComment)
      for (const { editor: ed, side } of editors.current) {
        const allowed = (n: number) =>
          callbacks.current.commentable?.[side].some(
            (r) => n >= r.startLine && n <= r.line,
          ) ?? false;
        const ranges = callbacks.current.commentable?.[side] ?? [];
        marginDecorations.push(
          ed.createDecorationsCollection(
            ranges.map((r) => ({
              range: new monaco.Range(r.startLine, 1, r.line, 1),
              options: {
                isWholeLine: true,
                glyphMarginClassName: "comment-add-glyph",
                glyphMarginHoverMessage: {
                  value:
                    "Clique ou arraste pela linha para comentar. Alt + arraste seleciona texto; Cmd/Ctrl + clique navega.",
                },
              },
            })),
          ),
        );
        let drag: { start: number; end: number; hunk: LineRange } | null = null;
        const hover = ed.createDecorationsCollection();
        marginDecorations.push(hover);
        const selection = ed.createDecorationsCollection();
        marginDecorations.push(selection);
        const paint = () => {
          if (!drag) return;
          selection.set([
            {
              range: new monaco.Range(
                Math.min(drag.start, drag.end),
                1,
                Math.max(drag.start, drag.end),
                1,
              ),
              options: {
                isWholeLine: true,
                className: "comment-range-selection",
              },
            },
          ]);
        };
        const dom = ed.getDomNode()!;
        const down = (event: MouseEvent) => {
          if (!(event.target instanceof Node) || !dom.contains(event.target))
            return;
          if (
            event.target instanceof Element &&
            event.target.closest(
              ".codicon-folding-expanded, .codicon-folding-collapsed, .inline-comment-form, .saved-comment-card",
            )
          )
            return;
          const target = ed.getTargetAtClientPoint(
            event.clientX,
            event.clientY,
          );
          if (event.altKey && event.button === 0 && target?.position) {
            ed.focus();
            ed.setPosition(target.position);
          }
          if (
            !target?.position ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            !allowed(target.position.lineNumber) ||
            ![
              monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN,
              monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS,
              monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS,
              monaco.editor.MouseTargetType.CONTENT_TEXT,
              monaco.editor.MouseTargetType.CONTENT_EMPTY,
            ].includes(target.type)
          )
            return;
          event.preventDefault();
          event.stopImmediatePropagation();
          ed.focus();
          window.getSelection()?.removeAllRanges();
          ed.setPosition({ lineNumber: target.position.lineNumber, column: 1 });
          dom.classList.add("comment-line-dragging");
          const n = target.position.lineNumber;
          const hunk = callbacks.current.commentable![side].find(
            (r) => n >= r.startLine && n <= r.line,
          )!;
          drag = { start: n, end: n, hunk };
          paint();
        };
        const move = (event: MouseEvent) => {
          if (!drag) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          const n = ed.getTargetAtClientPoint(event.clientX, event.clientY)
            ?.position?.lineNumber;
          if (!n) return;
          drag.end = Math.max(drag.hunk.startLine, Math.min(n, drag.hunk.line));
          paint();
        };
        window.addEventListener("pointerdown", down, true);
        window.addEventListener("mousedown", down, true);
        window.addEventListener("pointermove", move, true);
        window.addEventListener("mousemove", move, true);
        releaseHandlers.push(() => {
          window.removeEventListener("pointerdown", down, true);
          window.removeEventListener("mousedown", down, true);
          window.removeEventListener("pointermove", move, true);
          window.removeEventListener("mousemove", move, true);
        });
        commentListeners.push(
          ed.onMouseLeave(() => {
            if (!drag) hover.clear();
          }),
          ed.onMouseMove((e) => {
            if (drag) return;
            const n = e.target.position?.lineNumber;
            const content = [
              monaco.editor.MouseTargetType.CONTENT_TEXT,
              monaco.editor.MouseTargetType.CONTENT_EMPTY,
              monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN,
              monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS,
              monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS,
            ].includes(e.target.type);
            hover.set(
              content && n && allowed(n)
                ? [
                    {
                      range: new monaco.Range(n, 1, n, 1),
                      options: {
                        glyphMarginClassName: "comment-glyph-hover",
                        className: "comment-line-hover",
                        isWholeLine: true,
                      },
                    },
                  ]
                : [],
            );
          }),
        );
        const release = (event: MouseEvent) => {
          if (!drag) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          const range = {
            startLine: Math.min(drag.start, drag.end),
            line: Math.max(drag.start, drag.end),
          };
          drag = null;
          dom.classList.remove("comment-line-dragging");
          selection.clear();
          callbacks.current.onComment?.(side, range);
        };
        const cancel = () => {
          drag = null;
          dom.classList.remove("comment-line-dragging");
          selection.clear();
        };
        window.addEventListener("pointerup", release, true);
        window.addEventListener("mouseup", release, true);
        window.addEventListener("pointercancel", cancel);
        window.addEventListener("blur", cancel);
        releaseHandlers.push(() => {
          window.removeEventListener("pointerup", release, true);
          window.removeEventListener("mouseup", release, true);
          window.removeEventListener("pointercancel", cancel);
          window.removeEventListener("blur", cancel);
          cancel();
        });
        commentListeners.push(
          ed.addAction({
            id: "lince.comment",
            label: "Comentar seleção (rascunho local)",
            keybindings: [
              monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyM,
            ],
            contextMenuGroupId: "navigation",
            run: () => {
              const s = ed.getSelection();
              if (s) callbacks.current.onComment?.(side, selectedLines(s));
            },
          }),
        );
      }
    callbacks.current.onReady?.({
      get editor() {
        return focused;
      },
      diff,
    });
    return () => {
      releaseHandlers.forEach((release) => release());
      commentListeners.forEach((d) => d.dispose());
      marginDecorations.forEach((d) => d.clear());
      draftDecorations.current.forEach((d) => d.clear());
      draftDecorations.current = [];
      editors.current = [];
      focusListeners.forEach((d) => d.dispose());
      scroll.dispose();
      computed?.dispose();
      diff ? diff.dispose() : editor.dispose();
    };
  }, [model, original, line, column]);
  useEffect(() => {
    if (!inlineTarget) return;
    const ed = editors.current.find(
      (entry) => entry.side === inlineTarget.side,
    )?.editor;
    if (!ed) return;
    const previousTop = ed.getScrollTop();
    const node = document.createElement("div");
    node.className = "inline-comment-zone";
    const slot = document.createElement("div");
    node.appendChild(slot);
    const zone: monaco.editor.IViewZone = {
      afterLineNumber: inlineTarget.line,
      heightInPx: 280,
      domNode: node,
      suppressMouseDown: false,
    };
    let id = "";
    ed.changeViewZones((accessor) => {
      id = accessor.addZone(zone);
    });
    // Monaco hides decorative view zones from assistive technology by default.
    // This zone contains an interactive form and must remain accessible.
    const container = node.parentElement;
    const hidden = container?.getAttribute("aria-hidden");
    container?.removeAttribute("aria-hidden");
    container?.classList.add("comment-view-zones");
    const highlight = ed.createDecorationsCollection([
      {
        range: new monaco.Range(
          inlineTarget.startLine,
          1,
          inlineTarget.line,
          1,
        ),
        options: {
          isWholeLine: true,
          className: "comment-range-selection",
          linesDecorationsClassName: "comment-range-edge",
        },
      },
    ]);
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(slot.getBoundingClientRect().height) + 12;
      if (height > 12 && height !== zone.heightInPx) {
        zone.heightInPx = height;
        ed.changeViewZones((accessor) => accessor.layoutZone(id));
      }
    });
    observer.observe(slot);
    callbacks.current.onCommentHost?.(slot);
    const frame = requestAnimationFrame(() => {
      ed.setScrollTop(
        Math.max(0, ed.getTopForLineNumber(inlineTarget.line) - 100),
      );
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      highlight.clear();
      ed.changeViewZones((accessor) => accessor.removeZone(id));
      ed.setScrollTop(previousTop, monaco.editor.ScrollType.Immediate);
      if (!container?.querySelector(".saved-comment-zone")) {
        container?.classList.remove("comment-view-zones");
        if (hidden != null) container?.setAttribute("aria-hidden", hidden);
      }
      callbacks.current.onCommentHost?.(null);
    };
  }, [inlineTarget, model, original, line, column]);
  useEffect(() => {
    const hosts: { comment: DraftComment; host: HTMLElement }[] = [];
    const cleanup: (() => void)[] = [];
    for (const { editor: ed, side } of editors.current) {
      for (const comment of (JSON.parse(savedKey) as DraftComment[]).filter(
        (c) => c.side === side,
      )) {
        const node = document.createElement("div");
        node.className = "saved-comment-zone";
        const host = document.createElement("div");
        node.appendChild(host);
        const zone: monaco.editor.IViewZone = {
          afterLineNumber: comment.line,
          ordinal: 1,
          heightInPx: 100,
          domNode: node,
          suppressMouseDown: false,
        };
        let id = "";
        ed.changeViewZones((accessor) => {
          id = accessor.addZone(zone);
        });
        const container = node.parentElement;
        container?.removeAttribute("aria-hidden");
        container?.classList.add("comment-view-zones");
        const observer = new ResizeObserver(() => {
          const height = Math.ceil(host.getBoundingClientRect().height) + 12;
          if (height > 12 && height !== zone.heightInPx) {
            zone.heightInPx = height;
            ed.changeViewZones((a) => a.layoutZone(id));
          }
        });
        observer.observe(host);
        hosts.push({ comment, host });
        cleanup.push(() => {
          observer.disconnect();
          ed.changeViewZones((a) => a.removeZone(id));
          if (
            !container?.querySelector(
              ".inline-comment-zone, .saved-comment-zone",
            )
          ) {
            container?.classList.remove("comment-view-zones");
            container?.setAttribute("aria-hidden", "true");
          }
        });
      }
    }
    setSavedHosts(hosts);
    return () => cleanup.forEach((fn) => fn());
  }, [savedKey, model, original, line, column]);
  useEffect(() => {
    draftDecorations.current.forEach((d) => d.clear());
    draftDecorations.current = editors.current.map(({ editor, side }) =>
      editor.createDecorationsCollection(
        (draftRanges ?? [])
          .filter((r) => r.side === side)
          .map((r) => ({
            range: new monaco.Range(r.startLine, 1, r.line, 1),
            options: {
              isWholeLine: true,
              linesDecorationsClassName: "comment-draft-marker",
              hoverMessage: {
                value:
                  "Comentário local pendente. Confira em Comentários antes de aplicar.",
              },
            },
          })),
      ),
    );
  }, [draftRanges, model, original]);
  return (
    <>
      {savedHosts.map(({ comment, host }) =>
        createPortal(
          <section
            className="saved-comment-card"
            aria-label={`Comentário salvo: ${comment.side === "LEFT" ? "base" : "head"} · linhas ${comment.startLine}–${comment.line}`}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <header>
              <strong>Comentário</strong>
              <span>
                {comment.side === "LEFT" ? "base" : "head"} ·{" "}
                {comment.startLine === comment.line
                  ? `linha ${comment.line}`
                  : `linhas ${comment.startLine}–${comment.line}`}
              </span>
              <button onClick={() => onEditDraft?.(comment.id)}>
                Editar comentário salvo
              </button>
            </header>
            <div className="saved-comment-body">
              <MarkdownPreview body={comment.body} />
            </div>
            <small>Rascunho local · pendente de Aplicar tudo</small>
          </section>,
          host,
          comment.id,
        ),
      )}
      <div
        className="code-editor"
        ref={root}
        data-testid={original ? "diff-editor" : "source-editor"}
      />
    </>
  );
}
