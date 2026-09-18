import { useEffect, useRef } from "react";
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
  draftRanges?: { side: "LEFT" | "RIGHT"; startLine: number; line: number }[];
}) {
  const root = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onScroll, onReady, onComment, commentable });
  callbacks.current = { onScroll, onReady, onComment, commentable };
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
      if (!restoring) callbacks.current.onScroll?.(e.scrollTop, e.scrollLeft);
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
                    "Adicionar comentário local. Arraste o + para selecionar várias linhas.",
                },
              },
            })),
          ),
        );
        let drag: { start: number; end: number } | null = null;
        const selection = ed.createDecorationsCollection();
        marginDecorations.push(selection);
        commentListeners.push(
          ed.onMouseDown((e) => {
            if (
              e.target.type !==
                monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
              !e.event.leftButton ||
              !e.target.position ||
              !allowed(e.target.position.lineNumber)
            )
              return;
            e.event.preventDefault();
            ed.focus();
            const line = e.target.position.lineNumber;
            const selected = ed.getSelection();
            const range = selected
              ? selectedLines(selected)
              : { startLine: line, line };
            drag =
              range.startLine !== range.line &&
              line >= range.startLine &&
              line <= range.line
                ? { start: range.startLine, end: range.line }
                : { start: line, end: line };
            selection.set([
              {
                range: new monaco.Range(drag.start, 1, drag.end, 1),
                options: {
                  isWholeLine: true,
                  className: "comment-range-selection",
                },
              },
            ]);
          }),
          ed.onMouseMove((e) => {
            if (!drag || !e.target.position) return;
            drag.end = e.target.position.lineNumber;
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
          }),
        );
        const release = () => {
          if (!drag) return;
          const range = {
            startLine: Math.min(drag.start, drag.end),
            line: Math.max(drag.start, drag.end),
          };
          drag = null;
          selection.clear();
          callbacks.current.onComment?.(side, range);
        };
        window.addEventListener("mouseup", release);
        releaseHandlers.push(() =>
          window.removeEventListener("mouseup", release),
        );
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
    <div
      className="code-editor"
      ref={root}
      data-testid={original ? "diff-editor" : "source-editor"}
    />
  );
}
