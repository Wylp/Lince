import { useId, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { formatMarkdown } from "./markdown-edit";
import type { Format } from "./markdown-edit";

export function MarkdownPreview({ body }: { body: string }) {
  return (
    <div className="markdown-body">
      <Markdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        skipHtml
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
          img: ({ node: _node, ...props }) => (
            <img {...props} loading="lazy" referrerPolicy="no-referrer" />
          ),
        }}
      >
        {body}
      </Markdown>
    </div>
  );
}
const tools: [Format, string, string][] = [
  ["heading", "H", "Título"],
  ["bold", "B", "Negrito"],
  ["italic", "𝑰", "Itálico"],
  ["strike", "S", "Tachado"],
  ["quote", "❯", "Citação"],
  ["code", "‹›", "Código inline"],
  ["block", "{ }", "Bloco de código"],
  ["link", "↗", "Link"],
  ["bullet", "☷", "Lista com marcadores"],
  ["number", "1.", "Lista numerada"],
  ["task", "☑", "Lista de tarefas"],
  ["table", "▦", "Tabela"],
  ["mention", "@", "Mencionar usuário"],
  ["reference", "#", "Referência a issue ou PR"],
  ["image", "▧", "Imagem por URL"],
  ["suggestion", "±", "Sugestão de alteração"],
];
export function MarkdownComposer({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const history = useRef<string[]>([]),
    future = useRef<string[]>([]);
  const id = useId();
  function change(next: string) {
    if (next.length > 16000) {
      setError("O comentário pode ter até 16.000 caracteres.");
      return false;
    }
    history.current.push(value);
    if (history.current.length > 100) history.current.shift();
    future.current = [];
    setError("");
    onChange(next);
    return true;
  }
  function format(action: Format) {
    const area = input.current;
    if (!area || disabled) return;
    const edit = formatMarkdown(
      value,
      area.selectionStart,
      area.selectionEnd,
      action,
    );
    if (change(edit.value))
      requestAnimationFrame(() => {
        area.focus();
        area.setSelectionRange(edit.start, edit.end);
      });
  }
  function undo(redo = false) {
    if (disabled) return;
    const from = redo ? future : history,
      to = redo ? history : future;
    const next = from.current.pop();
    if (next === undefined) return;
    to.current.push(value);
    onChange(next);
    setError("");
    input.current?.focus();
  }
  return (
    <div className="markdown-composer">
      <div className="markdown-bar">
        <div role="tablist" aria-label="Modo do comentário">
          {[false, true].map((p) => (
            <button
              key={String(p)}
              id={`${id}-${p}`}
              role="tab"
              aria-selected={preview === p}
              aria-controls={`${id}-panel`}
              tabIndex={preview === p ? 0 : -1}
              onClick={() => setPreview(p)}
              onKeyDown={(e) => {
                if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
                  e.preventDefault();
                  setPreview(!p);
                  document.getElementById(`${id}-${!p}`)?.focus();
                }
              }}
            >
              {p ? "Prévia" : "Escrever"}
            </button>
          ))}
        </div>
        <div
          role="toolbar"
          aria-label="Formatação Markdown"
          className="markdown-tools"
        >
          {tools.map(([action, icon, label]) => (
            <button
              key={action}
              type="button"
              title={label}
              aria-label={label}
              disabled={disabled || preview}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => format(action)}
            >
              {action === "strike" ? <s>{icon}</s> : icon}
            </button>
          ))}
          <button
            type="button"
            aria-label="Desfazer"
            title="Desfazer"
            disabled={disabled || preview || !history.current.length}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => undo()}
          >
            ↶
          </button>
          <button
            type="button"
            aria-label="Refazer"
            title="Refazer"
            disabled={disabled || preview || !future.current.length}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => undo(true)}
          >
            ↷
          </button>
        </div>
      </div>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${preview}`}
        className="markdown-panel"
      >
        {preview ? (
          <div className="markdown-preview" aria-label="Prévia do comentário">
            {value.trim() ? (
              <MarkdownPreview body={value} />
            ) : (
              <p className="muted">Nada para visualizar ainda.</p>
            )}
          </div>
        ) : (
          <textarea
            ref={input}
            autoFocus
            aria-label="Comentário da revisão"
            placeholder="Escreva seu comentário em Markdown…"
            value={value}
            disabled={disabled}
            maxLength={16000}
            onChange={(e) => change(e.target.value)}
            onKeyDownCapture={(e) => {
              if (!(e.metaKey || e.ctrlKey)) return;
              const key = e.key.toLowerCase();
              if (["b", "i", "k", "z"].includes(key)) {
                e.preventDefault();
                e.stopPropagation();
                if (key === "z") undo(e.shiftKey);
                else
                  format(
                    key === "b" ? "bold" : key === "i" ? "italic" : "link",
                  );
              }
            }}
          />
        )}
      </div>
      <div className="markdown-help">
        <span>Markdown do GitHub · imagens por URL</span>
        <span>{value.length.toLocaleString("pt-BR")}/16.000</span>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
