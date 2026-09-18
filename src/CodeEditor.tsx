import { useEffect, useRef } from "react";
import { monaco, options } from "./editor";
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
}: {
  model: monaco.editor.ITextModel;
  original?: monaco.editor.ITextModel;
  position?: { top: number; left: number };
  onScroll?: (top: number, left: number) => void;
  onReady?: (handle: EditorHandle) => void;
  line?: number;
  column?: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onScroll, onReady });
  callbacks.current = { onScroll, onReady };
  useEffect(() => {
    const diff = original
      ? monaco.editor.createDiffEditor(root.current!, {
          ...options,
          originalEditable: false,
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
      : monaco.editor.create(root.current!, { ...options, model });
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
    callbacks.current.onReady?.({
      get editor() {
        return focused;
      },
      diff,
    });
    return () => {
      focusListeners.forEach((d) => d.dispose());
      scroll.dispose();
      computed?.dispose();
      diff ? diff.dispose() : editor.dispose();
    };
  }, [model, original, line, column]);
  return (
    <div
      className="code-editor"
      ref={root}
      data-testid={original ? "diff-editor" : "source-editor"}
    />
  );
}
