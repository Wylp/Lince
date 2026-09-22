import { useEffect, useState } from "react";
import type { monaco } from "./editor";

export function DiffNavigation({
  diff,
}: {
  diff: monaco.editor.IStandaloneDiffEditor;
}) {
  const [total, setTotal] = useState<number | null>(null);
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    const update = () => {
      const changes = diff.getLineChanges();
      setTotal(changes?.length ?? null);
      const line = diff.getModifiedEditor().getPosition()?.lineNumber ?? 1;
      setCurrent(
        (changes?.findIndex((change) => {
          // A deletion points to the line before the empty modified range.
          const start =
            change.modifiedEndLineNumber === 0
              ? Math.min(
                  change.modifiedStartLineNumber + 1,
                  diff.getModifiedEditor().getModel()!.getLineCount(),
                )
              : change.modifiedStartLineNumber;
          return (
            line >= start &&
            line <= Math.max(start, change.modifiedEndLineNumber)
          );
        }) ?? -1) + 1,
      );
    };
    update();
    const computed = diff.onDidUpdateDiff(update);
    const cursor = diff.getModifiedEditor().onDidChangeCursorPosition(update);
    return () => {
      computed.dispose();
      cursor.dispose();
    };
  }, [diff]);

  return (
    <div
      className="diff-navigation"
      role="group"
      aria-label="Navegar pelas alterações"
    >
      <span title="Trechos alterados neste arquivo. O mapa à direita mostra suas posições: verde para adições e vermelho para remoções.">
        {total === null
          ? "Calculando alterações…"
          : total === 0
            ? "Sem alterações"
            : total === 1
              ? "1 alteração"
              : current
                ? `${current} de ${total} alterações`
                : `${total} ${total === 1 ? "alteração" : "alterações"}`}
      </span>
      <button
        disabled={!total}
        aria-label="Alteração anterior"
        title="Ir à alteração anterior"
        onClick={() => diff.goToDiff("previous")}
      >
        ↑
      </button>
      <button
        disabled={!total}
        aria-label="Próxima alteração"
        title="Ir à próxima alteração"
        onClick={() => diff.goToDiff("next")}
      >
        ↓
      </button>
    </div>
  );
}
