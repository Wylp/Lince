import { createPortal } from "react-dom";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Snapshot } from "./model";
export interface CommentTarget {
  path: string;
  side: "LEFT" | "RIGHT";
  startLine: number;
  line: number;
}
export interface DraftComment extends CommentTarget {
  id: string;
  body: string;
}
interface Draft {
  snapshotId: string;
  revision: number;
  comments: DraftComment[];
  state: string;
  batchId: string;
  lastUrl: string | null;
}
export interface CommentsHandle {
  compose: (target: CommentTarget) => void;
  hasUnsaved: () => boolean;
}
const empty: Draft = {
  snapshotId: "",
  revision: 0,
  comments: [],
  state: "ready",
  batchId: "",
  lastUrl: null,
};
export const ReviewComments = forwardRef<
  CommentsHandle,
  {
    snapshot: Snapshot;
    onChange: (comments: DraftComment[]) => void;
    host: HTMLElement | null;
    onTarget: (target: CommentTarget | null) => void;
  }
>(function ReviewComments({ snapshot, onChange, host, onTarget }, ref) {
  const [draft, setDraft] = useState<Draft>(empty),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [target, setTarget] = useState<CommentTarget | null>(null),
    [body, setBody] = useState(""),
    [editing, setEditing] = useState<string | null>(null),
    [listOpen, setListOpen] = useState(false),
    [confirmedAbsent, setConfirmedAbsent] = useState(false);
  const list = useRef<HTMLDialogElement>(null);
  const stale = draft.comments.length > 0 && draft.snapshotId !== snapshot.id;
  const locked = draft.state !== "ready";
  const update = (value: Draft) => {
    setDraft(value);
    onChange(value.snapshotId === snapshot.id ? value.comments : []);
  };
  async function reload() {
    const value = await invoke<Draft>("load_review_drafts", {
      snapshotId: snapshot.id,
    });
    update(value);
    setLoaded(true);
  }
  useEffect(() => {
    let alive = true;
    void invoke<Draft>("load_review_drafts", { snapshotId: snapshot.id })
      .then((value) => {
        if (alive) {
          update(value);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [snapshot.id]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !busy &&
        target &&
        event.target instanceof Node &&
        host?.contains(event.target)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setTarget(null);
      }
    };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  }, [host, busy, target]);
  useEffect(() => {
    onTarget(target);
  }, [target, onTarget]);
  useEffect(() => {
    if (listOpen) list.current?.showModal();
  }, [listOpen]);
  useImperativeHandle(ref, () => ({
    hasUnsaved: () => !!target && (!!body.trim() || busy),
    compose: (value) => {
      if (busy) return;
      if (target && body.trim()) {
        setError(
          "Salve ou cancele este rascunho antes de comentar outro trecho.",
        );
        onTarget(target);
        return;
      }
      if (!loaded || stale || locked) {
        setListOpen(true);
        return;
      }
      setTarget(value);
      setEditing(null);
      setBody("");
      setError("");
    },
  }));
  async function save(comments: DraftComment[]) {
    const value = await invoke<Draft>("save_review_drafts", {
      snapshotId: snapshot.id,
      revision: draft.revision,
      comments,
    });
    update(value);
  }
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(String(e));
      try {
        await reload();
      } catch {
        /* Keep local text and the original error. */
      }
    } finally {
      setBusy(false);
    }
  }
  const location = (c: CommentTarget) =>
    `${c.path} · ${c.side === "LEFT" ? "base" : "head"} · ${c.startLine === c.line ? `linha ${c.line}` : `linhas ${c.startLine}–${c.line}`}`;
  return (
    <>
      <button
        onClick={() => setListOpen(true)}
        title="Revisar os rascunhos locais antes de enviar"
      >
        Comentários ({draft.comments.length})
        {error && !listOpen && !target ? " !" : ""}
      </button>
      {target &&
        host &&
        createPortal(
          <section
            className="inline-comment-form"
            aria-label="Comentário nas linhas selecionadas"
            onKeyDownCapture={(e) => {
              e.stopPropagation();
              if (e.key === "Escape" && !busy) setTarget(null);
            }}
          >
            <h3>{editing ? "Editar rascunho" : "Novo comentário"}</h3>
            <p className="comment-location">{location(target)}</p>
            <p className="muted">
              Ao salvar, o rascunho fica neste dispositivo. Nada será enviado
              até você clicar em Aplicar tudo.
            </p>
            <label>
              Comentário
              <textarea
                autoFocus
                aria-label="Comentário da revisão"
                value={body}
                disabled={busy}
                onChange={(e) => setBody(e.target.value)}
                maxLength={16000}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <footer>
              <button disabled={busy} onClick={() => setTarget(null)}>
                Cancelar
              </button>
              <button
                className="primary"
                disabled={busy || !body.trim()}
                onClick={() =>
                  void run(async () => {
                    const comment = {
                      ...target,
                      body,
                      id: editing ?? crypto.randomUUID(),
                    };
                    await save(
                      editing
                        ? draft.comments.map((c) =>
                            c.id === editing ? comment : c,
                          )
                        : [...draft.comments, comment],
                    );
                    setTarget(null);
                    setBody("");
                  })
                }
              >
                {busy ? "Salvando…" : "Salvar rascunho"}
              </button>
            </footer>
          </section>,
          host,
        )}
      {listOpen && (
        <dialog
          className="review-drafts draft-list-dialog"
          ref={list}
          onCancel={(e) => {
            if (busy) e.preventDefault();
            else setListOpen(false);
          }}
        >
          <header>
            <div>
              <h3>Comentários da revisão</h3>
              <p>
                Confira todos os comentários antes de publicar em{" "}
                {snapshot.repo} #{snapshot.number}.
              </p>
            </div>
            <button
              aria-label="Fechar comentários"
              disabled={busy}
              onClick={() => setListOpen(false)}
            >
              ×
            </button>
          </header>
          {stale && (
            <p role="alert">
              Estes rascunhos pertencem a outra versão da PR. Confira e copie os
              textos antes de descartar; as linhas não serão transferidas
              automaticamente.
            </p>
          )}
          {locked && (
            <p role="alert">
              O envio anterior está sem confirmação. Verifique o resultado antes
              de editar ou enviar novamente.
            </p>
          )}
          {!draft.comments.length && (
            <p>
              {draft.lastUrl
                ? "Todos os comentários foram enviados ao GitHub."
                : "Nenhum comentário pendente. Use o + ao lado de uma linha, arraste para selecionar várias ou use o menu de contexto da seleção."}
            </p>
          )}
          <div className="draft-comment-list">
            {draft.comments.map((c, i) => (
              <article key={c.id}>
                <strong>{location(c)}</strong>
                <p className="draft-body">{c.body}</p>
                <div>
                  <button
                    disabled={busy || stale || locked}
                    aria-label={`Editar comentário ${i + 1}`}
                    onClick={() => {
                      setListOpen(false);
                      setEditing(c.id);
                      setTarget(c);
                      setBody(c.body);
                      setError("");
                    }}
                  >
                    Editar
                  </button>
                  <button
                    disabled={busy || locked}
                    aria-label={`Remover comentário ${i + 1}`}
                    onClick={() =>
                      void run(async () => {
                        if (stale) {
                          setError(
                            "Para preservar as posições, descarte o lote antigo inteiro após conferir os textos.",
                          );
                          return;
                        }
                        await save(draft.comments.filter((d) => d.id !== c.id));
                      })
                    }
                  >
                    Remover
                  </button>
                </div>
              </article>
            ))}
          </div>
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          {locked && (
            <label className="retry-confirmation">
              <input
                type="checkbox"
                checked={confirmedAbsent}
                onChange={(e) => setConfirmedAbsent(e.target.checked)}
                disabled={busy}
              />
              Conferi a PR no GitHub e confirmei que este lote não foi
              publicado.
            </label>
          )}
          <footer>
            <button disabled={busy} onClick={() => void run(reload)}>
              Recarregar lista
            </button>
            {stale && !locked && (
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await save([]);
                  })
                }
              >
                Descartar rascunhos antigos
              </button>
            )}
            {locked ? (
              <>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      update(
                        await invoke<Draft>("check_review_submission", {
                          snapshotId: snapshot.id,
                          allowRetry: false,
                        }),
                      );
                      setNotice("Envio confirmado no GitHub.");
                    })
                  }
                >
                  Verificar envio
                </button>
                <button
                  disabled={busy || !confirmedAbsent}
                  onClick={() =>
                    void run(async () => {
                      update(
                        await invoke<Draft>("check_review_submission", {
                          snapshotId: snapshot.id,
                          allowRetry: true,
                        }),
                      );
                      setConfirmedAbsent(false);
                      setNotice(
                        "Resultado conferido. Revise a lista antes de aplicar novamente.",
                      );
                    })
                  }
                >
                  Liberar nova tentativa
                </button>
              </>
            ) : (
              <button
                className="primary"
                disabled={busy || !loaded || stale || !draft.comments.length}
                onClick={() =>
                  void run(async () => {
                    update(
                      await invoke<Draft>("submit_review_drafts", {
                        snapshotId: snapshot.id,
                        revision: draft.revision,
                      }),
                    );
                    setNotice(
                      "Todos os comentários foram publicados em uma única revisão no GitHub.",
                    );
                  })
                }
              >
                {busy
                  ? "Aplicando…"
                  : `Aplicar tudo (${draft.comments.length})`}
              </button>
            )}
          </footer>
        </dialog>
      )}
    </>
  );
});
