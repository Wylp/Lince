import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  monaco,
  Project,
  language,
  semanticLanguage,
  syntaxLanguages,
} from "./editor";
import type { Document, Location, RepoIndex, Side } from "./editor";
import { CodeEditor } from "./CodeEditor";
import type { EditorHandle } from "./CodeEditor";
import { FileTree } from "./FileTree";
import { RepositoryTree } from "./RepositoryTree";
import type { FileDiff, ReviewProgress, Snapshot } from "./model";
interface LoadedFile {
  path: string;
  before: string | null;
  after: string | null;
  diff: FileDiff;
}
interface Bundle {
  files: Record<string, LoadedFile>;
}
interface Tab extends Location {
  mode: "diff" | "code";
}
const key = (tab: Tab) => `${tab.mode}:${tab.side}:${tab.path}`;
export default function CodeWorkspace({
  snapshot,
  review,
  select,
  mark,
  saveScroll,
  loading,
}: {
  snapshot: Snapshot;
  review: ReviewProgress;
  select: (path: string) => void;
  mark: (path: string, value: boolean) => void;
  saveScroll: (path: string, top: number, left: number) => void;
  loading: boolean;
}) {
  const [pinned, setPinned] = useState(false),
    [hovered, setHovered] = useState(false),
    [keyboardTree, setKeyboardTree] = useState(false),
    [treeOpen, setTreeOpen] = useState(false);
  const explorerOpen = pinned || hovered || keyboardTree || treeOpen;
  const [bundle, setBundle] = useState<Bundle | null>(null),
    [project, setProject] = useState<Project | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const [tab, setTab] = useState<Tab>({
      path: review.selected,
      side: "head",
      mode: "diff",
    }),
    [tabs, setTabs] = useState<Tab[]>([]),
    [tree, setTree] = useState<"changes" | "repo">("changes"),
    [side, setSide] = useState<Side>("head");
  const [filter, setFilter] = useState(""),
    [pending, setPending] = useState(false),
    [doc, setDoc] = useState<Document | null>(null),
    [message, setMessage] = useState("");
  const [comment, setComment] = useState<{
      path: string;
      side: "LEFT" | "RIGHT";
      line: number;
    } | null>(null),
    [body, setBody] = useState(""),
    [posting, setPosting] = useState(false),
    [commentError, setCommentError] = useState("");
  const commentDialog = useRef<HTMLDialogElement>(null);
  const [peek, setPeek] = useState<monaco.languages.Location[]>([]),
    [peekIndex, setPeekIndex] = useState(0),
    [quick, setQuick] = useState(false),
    [quickQuery, setQuickQuery] = useState("");
  const handle = useRef<EditorHandle | null>(null),
    navigateRef = useRef<(tab: Tab, record?: boolean) => void>(() => {}),
    previewRef = useRef<(editor: monaco.editor.IStandaloneCodeEditor) => void>(
      () => {},
    );
  const positions = useRef(new Map<string, { top: number; left: number }>()),
    documents = useRef(new Map<string, Document>());
  const history = useRef<Tab[]>([]),
    cursor = useRef(-1);
  const [, redraw] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null),
    finder = useRef<HTMLDialogElement>(null);
  function navigate(next: Tab, record = true) {
    setTab(next);
    setDoc(null);
    setMessage("");
    setTabs((old) => {
      const clean = old.filter((t) => key(t) !== key(next));
      return [...clean.slice(-11), next];
    });
    if (next.mode === "diff") select(next.path);
    if (record) {
      history.current = history.current.slice(0, cursor.current + 1);
      history.current.push(next);
      cursor.current = history.current.length - 1;
    }
    redraw((n) => n + 1);
  }
  navigateRef.current = navigate;
  useEffect(() => {
    let stale = false;
    let instance: Project | null = null;
    setError("");
    void Promise.all([
      invoke<Bundle>("get_pr_files", { snapshotId: snapshot.id }),
      invoke<RepoIndex>("get_repository_index", { snapshotId: snapshot.id }),
    ])
      .then(async ([bundle, index]) => {
        if (stale) return;
        instance = new Project(snapshot.id, index, (message) => {
          if (!stale) setMessage(message);
        });
        await instance.initialize();
        if (stale) {
          instance.dispose();
          return;
        }
        for (const doc of index.analysis)
          documents.current.set(`${doc.side}:${doc.path}`, doc);
        setBundle(bundle);
        setProject(instance);
        navigateRef.current({
          path: review.selected,
          mode: "diff",
          side: "head",
        });
      })
      .catch((e) => {
        if (!stale) setError(String(e));
      });
    return () => {
      stale = true;
      instance?.dispose();
    };
  }, [snapshot.id, retry]);
  useEffect(() => {
    if (!project) return;
    const opener = monaco.editor.registerEditorOpener({
      openCodeEditor: (_source, uri, selection) => {
        const target = project.location(uri);
        if (!target) return false;
        const line =
          selection &&
          ("startLineNumber" in selection
            ? selection.startLineNumber
            : selection.lineNumber);
        const column =
          selection &&
          ("startColumn" in selection
            ? selection.startColumn
            : selection.column);
        navigateRef.current({ ...target, mode: "code", line, column });
        return true;
      },
    });
    return () => opener.dispose();
  }, [project]);
  useEffect(() => {
    if (tab.mode !== "code" || !project) return;
    let stale = false;
    const saved = documents.current.get(`${tab.side}:${tab.path}`);
    if (saved) {
      setDoc(saved);
      return;
    }
    void invoke<Document>("read_repository_file", {
      snapshotId: snapshot.id,
      side: tab.side,
      path: tab.path,
    })
      .then((doc) => {
        documents.current.set(`${doc.side}:${doc.path}`, doc);
        if (!stale) setDoc(doc);
      })
      .catch((e) => {
        if (!stale)
          setDoc({
            path: tab.path,
            side: tab.side,
            text: null,
            reason: String(e),
          });
      });
    return () => {
      stale = true;
    };
  }, [tab, project, snapshot.id]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setQuick(true);
        setQuickQuery("");
      }
      if (
        event.altKey &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight")
      ) {
        event.preventDefault();
        travel(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => {
    if (peek.length) dialog.current?.showModal();
  }, [peek]);
  useEffect(() => {
    if (comment) commentDialog.current?.showModal();
  }, [comment]);
  useEffect(() => {
    if (quick) finder.current?.showModal();
  }, [quick]);
  function travel(delta: number) {
    const next = cursor.current + delta;
    if (next < 0 || next >= history.current.length) return;
    cursor.current = next;
    navigateRef.current(history.current[next], false);
  }
  async function preview(editor: monaco.editor.IStandaloneCodeEditor) {
    if (!project || !editor.getModel() || !editor.getPosition()) return;
    try {
      const matches = await project.definitions(
        editor.getModel()!,
        editor.getPosition()!,
      );
      if (matches.length) {
        setPeek(matches);
        setPeekIndex(0);
      } else if (semanticLanguage(editor.getModel()!.getLanguageId())) {
        setMessage(
          "Definição não encontrada no código indexado. Dependências externas não são instaladas.",
        );
      }
    } catch (e) {
      setMessage(String(e));
    }
  }
  previewRef.current = (editor) => {
    void preview(editor);
  };
  const changed = new Set(snapshot.files.map((f) => f.path));
  const currentFile = snapshot.files.find((f) => f.path === tab.path);
  const changedPaths = snapshot.files.filter(
    (f) =>
      f.path.toLowerCase().includes(filter.toLowerCase()) &&
      (!pending || !review.files[f.path]?.reviewed),
  );
  const repoPaths = useMemo(
    () =>
      project
        ? project.index[side]
            .map((e) => e.path)
            .filter((path) => path.toLowerCase().includes(filter.toLowerCase()))
        : [],
    [project, side, filter],
  );
  const loaded = bundle?.files[tab.path];
  const viewable =
    tab.mode === "diff"
      ? loaded?.before !== null && loaded?.after !== null
      : doc?.text !== null;
  const model =
    project &&
    (tab.mode === "diff" && loaded?.after != null
      ? project.model({
          path: tab.path,
          side: "head",
          text: loaded.after,
          reason: null,
        })
      : tab.mode === "code" && doc?.text != null
        ? project.model(doc)
        : null);
  const original =
    project && tab.mode === "diff" && loaded?.before != null
      ? project.model({
          path: currentFile?.previousPath ?? tab.path,
          side: "base",
          text: loaded.before,
          reason: null,
        })
      : undefined;
  const quickPaths = (project?.index[side] ?? [])
    .filter((e) => e.path.toLowerCase().includes(quickQuery.toLowerCase()))
    .slice(0, 60);
  const peekLocation = peek[peekIndex];
  const peekModel = peekLocation
    ? monaco.editor.getModel(peekLocation.uri)
    : null;
  if (error)
    return (
      <div className="notice" role="alert">
        <h3>Não foi possível abrir o workspace</h3>
        <p>{error}</p>
        <button onClick={() => setRetry((n) => n + 1)}>Tentar novamente</button>
      </div>
    );
  if (!project || !bundle)
    return (
      <div className="notice" role="status">
        <span className="spinner" />
        <p>Preparando editor e índice de referências…</p>
      </div>
    );
  return (
    <div className="workspace code-workspace" inert={loading}>
      <div
        className={`explorer-dock ${pinned ? "pinned" : ""} ${explorerOpen ? "expanded" : ""}`}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => {
          setHovered(false);
          setTreeOpen(false);
        }}
        onFocusCapture={(e) => {
          if (e.target.matches(":focus-visible")) setKeyboardTree(true);
        }}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
            setKeyboardTree(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !pinned) {
            setHovered(false);
            setTreeOpen(false);
            setKeyboardTree(false);
            handle.current?.editor.focus();
          }
        }}
      >
        <div className="explorer-rail">
          <button
            aria-label="Mostrar arquivos"
            aria-expanded={explorerOpen}
            aria-controls="file-explorer"
            title="Arquivos · passe o mouse ou use Cmd/Ctrl+P"
            onClick={() => setTreeOpen((v) => !v)}
          >
            ▱
          </button>
          <small title="Arquivos pendentes">
            {
              snapshot.files.filter((f) => !review.files[f.path]?.reviewed)
                .length
            }
          </small>
          <button
            aria-label="Buscar arquivo"
            title="Buscar arquivo (Cmd/Ctrl+P)"
            onClick={() => {
              setQuickQuery("");
              setQuick(true);
            }}
          >
            ⌕
          </button>
        </div>
        <aside
          className="sidebar"
          id="file-explorer"
          inert={!explorerOpen}
          aria-hidden={!explorerOpen}
        >
          <div className="explorer-heading">
            <strong>Arquivos</strong>
            <button
              aria-label={pinned ? "Desafixar explorador" : "Fixar explorador"}
              aria-pressed={pinned}
              onClick={() => setPinned((v) => !v)}
              title={pinned ? "Recolher quando sair" : "Manter aberto"}
            >
              {pinned ? "◀" : "⊙"}
            </button>
          </div>
          <div className="explorer-tabs">
            <button
              className={tree === "changes" ? "active" : ""}
              onClick={() => setTree("changes")}
            >
              Alterações <small>{snapshot.files.length}</small>
            </button>
            <button
              className={tree === "repo" ? "active" : ""}
              onClick={() => setTree("repo")}
            >
              Explorador
            </button>
          </div>
          <label className="search">
            <span>⌕</span>
            <input
              aria-label="Filtrar arquivos"
              placeholder="Encontrar arquivo…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          {tree === "changes" ? (
            <label className="pending-filter">
              <input
                type="checkbox"
                checked={pending}
                onChange={(e) => setPending(e.target.checked)}
              />{" "}
              Apenas pendentes
            </label>
          ) : (
            <div className="explorer-tabs">
              <button
                className={side === "head" ? "active" : ""}
                onClick={() => setSide("head")}
              >
                Head
              </button>
              <button
                className={side === "base" ? "active" : ""}
                onClick={() => setSide("base")}
              >
                Base comum
              </button>
            </div>
          )}
          <div className="tree-scroll">
            {tree === "changes" ? (
              <FileTree
                files={changedPaths}
                progress={{
                  ...review,
                  selected: tab.mode === "diff" ? tab.path : "",
                }}
                select={(path) =>
                  navigate({ path, side: "head", mode: "diff" })
                }
              />
            ) : (
              <RepositoryTree
                paths={repoPaths}
                selected={tab.path}
                changed={changed}
                open={(path) => navigate({ path, side, mode: "code" })}
              />
            )}
          </div>
          <div className="sidebar-footer">
            <span>Somente leitura</span>
            <button
              onClick={() => {
                setQuickQuery("");
                setQuick(true);
              }}
              title="Cmd/Ctrl+P"
            >
              ⌕ Ir ao arquivo
            </button>
          </div>
        </aside>
      </div>
      <main className="reader">
        <div
          className="editor-tabs"
          role="tablist"
          aria-label="Arquivos abertos"
        >
          {tabs.map((t) => (
            <div
              className={`editor-tab ${key(tab) === key(t) ? "active" : ""}`}
              key={key(t)}
            >
              <button
                role="tab"
                aria-selected={key(tab) === key(t)}
                title={`${t.path} · ${t.mode === "diff" ? "Diff" : t.side}`}
                onClick={() => navigate(t)}
              >
                {t.path.split("/").at(-1)}{" "}
                <small>
                  {t.mode === "diff"
                    ? "±"
                    : t.side === "base"
                      ? "BASE"
                      : "HEAD"}
                </small>
              </button>
              <button
                aria-label={`Fechar aba ${t.path}`}
                disabled={tabs.length === 1}
                onClick={() => {
                  const rest = tabs.filter((x) => key(x) !== key(t));
                  setTabs(rest);
                  if (key(tab) === key(t) && rest.length)
                    navigate(rest.at(-1)!);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="file-header">
          <div className="file-heading">
            <strong title={tab.path}>{tab.path}</strong>
            <small>
              {tab.mode === "diff"
                ? "Diff acumulado"
                : `${tab.side === "head" ? "Head" : "Base comum"} · ${changed.has(tab.path) ? "arquivo alterado" : "arquivo de contexto"}`}
            </small>
          </div>
          <div className="file-actions">
            {currentFile && (
              <button
                onClick={() =>
                  navigate({
                    ...tab,
                    side: currentFile.status === "removed" ? "base" : "head",
                    path:
                      tab.mode === "diff" && currentFile.status === "removed"
                        ? (currentFile.previousPath ?? tab.path)
                        : tab.path,
                    mode: tab.mode === "diff" ? "code" : "diff",
                    line: undefined,
                  })
                }
              >
                {tab.mode === "diff" ? "Arquivo completo" : "Ver diff"}
              </button>
            )}
            {tab.mode === "diff" && (
              <label className="review-toggle">
                <input
                  type="checkbox"
                  aria-label="Marcar arquivo como revisado"
                  checked={review.files[tab.path]?.reviewed ?? false}
                  disabled={loading || !loaded?.diff.reviewable}
                  onChange={(e) => mark(tab.path, e.target.checked)}
                />{" "}
                Revisado
              </label>
            )}
          </div>
        </div>
        <div className="code-toolbar">
          <button
            aria-label="Voltar na navegação"
            disabled={cursor.current <= 0}
            onClick={() => travel(-1)}
          >
            ←
          </button>
          <button
            aria-label="Avançar na navegação"
            disabled={cursor.current >= history.current.length - 1}
            onClick={() => travel(1)}
          >
            →
          </button>
          <span>
            {tab.mode === "diff"
              ? `BASE ${snapshot.mergeBase.slice(0, 7)} ↔ HEAD ${snapshot.headSha.slice(0, 7)}`
              : `${tab.side.toUpperCase()} ${(tab.side === "head" ? snapshot.headSha : snapshot.mergeBase).slice(0, 7)}`}
          </span>
          <button
            onClick={() => {
              const ed = handle.current?.editor;
              if (ed)
                void ed.getAction("editor.action.revealDefinition")?.run();
            }}
          >
            Ir à definição <kbd>F12</kbd>
          </button>
          <button
            onClick={() => {
              const ed = handle.current?.editor;
              if (ed) void preview(ed);
            }}
          >
            Prévia da definição <kbd>⌥F12</kbd>
          </button>
          <button
            disabled={!currentFile || !loaded?.diff.reviewable}
            onClick={() => {
              const h = handle.current;
              if (!h) return;
              const old = h.diff?.getOriginalEditor();
              const ed = old?.hasTextFocus() ? old : h.editor;
              setComment({
                path: currentFile!.path,
                side: ed === old || tab.side === "base" ? "LEFT" : "RIGHT",
                line: ed.getPosition()?.lineNumber ?? 1,
              });
              setCommentError("");
            }}
          >
            Comentar linha
          </button>
          <button
            disabled={!semanticLanguage(language(tab.path))}
            title="Referências nos arquivos carregados do contexto JS/TS atual"
            onClick={() => {
              void handle.current?.editor
                .getAction("editor.action.referenceSearch.trigger")
                ?.run();
            }}
          >
            Referências
          </button>
        </div>
        {project.index.warnings.map((w) => (
          <div className="metadata-note" key={w}>
            {w}
          </div>
        ))}
        {message && (
          <div className="metadata-note" role="status">
            {message}
            <button onClick={() => setMessage("")}>×</button>
          </div>
        )}
        {tab.mode === "diff" && loaded?.diff.reason && viewable && (
          <div className="metadata-note">{loaded.diff.reason}</div>
        )}
        {model && viewable ? (
          <CodeEditor
            key={key(tab)}
            model={model}
            original={original}
            line={tab.line}
            column={tab.column}
            position={
              positions.current.get(key(tab)) ??
              (tab.mode === "diff" ? review.files[tab.path] : undefined)
            }
            onScroll={(top, left) => {
              positions.current.set(key(tab), { top, left });
              if (tab.mode === "diff") saveScroll(tab.path, top, left);
            }}
            onReady={(h) => {
              handle.current = h;
              for (const editor of [
                h.editor,
                ...(h.diff ? [h.diff.getOriginalEditor()] : []),
              ]) {
                editor.addAction({
                  id: "lince.peek",
                  label: "Pré-visualizar definição",
                  keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.F12],
                  contextMenuGroupId: "navigation",
                  contextMenuOrder: 1,
                  run: () => previewRef.current(editor),
                });
              }
            }}
          />
        ) : (
          <div className="notice">
            <h3>
              {tab.mode === "code" && !doc
                ? "Carregando arquivo local…"
                : "Arquivo indisponível"}
            </h3>
            <p>{tab.mode === "diff" ? loaded?.diff.reason : doc?.reason}</p>
          </div>
        )}
        <footer className="reader-footer">
          <span>
            {language(tab.path)} ·{" "}
            {["typescript", "javascript"].includes(language(tab.path))
              ? "Cmd/Ctrl+clique para seguir definições"
              : syntaxLanguages.includes(language(tab.path))
                ? "Cmd/Ctrl+clique · declarações candidatas por sintaxe"
                : "Destaque de sintaxe"}
          </span>
          <span>Somente leitura</span>
        </footer>
      </main>
      {!!peek.length && peekModel && (
        <dialog
          className="definition-dialog"
          ref={dialog}
          onCancel={() => setPeek([])}
        >
          <header>
            <div>
              <span className="eyebrow">
                PRÉVIA DA DEFINIÇÃO · SOMENTE LEITURA
              </span>
              <h3>{project.location(peekLocation.uri)?.path}</h3>
            </div>
            <button aria-label="Fechar prévia" onClick={() => setPeek([])}>
              ×
            </button>
          </header>
          {!semanticLanguage(peekModel.getLanguageId()) && (
            <p className="metadata-note">
              Declarações candidatas por sintaxe. Confira o contexto; tipos e
              sobrecargas não são resolvidos.
            </p>
          )}
          {peek.length > 1 && (
            <div className="peek-targets">
              {peek.map((p, i) => (
                <button key={i} onClick={() => setPeekIndex(i)}>
                  {project.location(p.uri)?.path}:{p.range.startLineNumber}
                </button>
              ))}
            </div>
          )}
          <CodeEditor
            model={peekModel}
            line={peekLocation.range.startLineNumber}
            column={peekLocation.range.startColumn}
          />
          <footer>
            <button
              className="primary"
              onClick={() => {
                const target = project.location(peekLocation.uri);
                if (target)
                  navigate({
                    ...target,
                    mode: "code",
                    line: peekLocation.range.startLineNumber,
                    column: peekLocation.range.startColumn,
                  });
                setPeek([]);
              }}
            >
              Abrir arquivo nesta linha
            </button>
          </footer>
        </dialog>
      )}
      {comment && (
        <dialog
          className="comment-dialog"
          ref={commentDialog}
          onCancel={(e) => {
            if (posting) e.preventDefault();
            else setComment(null);
          }}
        >
          <h3>Comentar no GitHub</h3>
          <p>
            {comment.path} · {comment.side === "LEFT" ? "base" : "head"} · linha{" "}
            {comment.line}
          </p>
          <label>
            Comentário
            <textarea
              autoFocus
              aria-label="Comentário da revisão"
              value={body}
              disabled={posting}
              onChange={(e) => setBody(e.target.value)}
              maxLength={16000}
            />
          </label>
          {commentError && <p role="alert">{commentError}</p>}
          <footer>
            <button disabled={posting} onClick={() => setComment(null)}>
              Cancelar
            </button>
            <button
              className="primary"
              disabled={posting || !body.trim()}
              onClick={() => {
                setPosting(true);
                setCommentError("");
                void invoke<string>("post_review_comment", {
                  snapshotId: snapshot.id,
                  ...comment,
                  body,
                })
                  .then(() => {
                    setComment(null);
                    setBody("");
                    setMessage("Comentário publicado no GitHub.");
                  })
                  .catch((e) => setCommentError(String(e)))
                  .finally(() => setPosting(false));
              }}
            >
              {posting ? "Publicando…" : "Publicar no GitHub"}
            </button>
          </footer>
        </dialog>
      )}
      {quick && (
        <dialog
          className="quick-file-dialog"
          ref={finder}
          onCancel={() => setQuick(false)}
        >
          <header>
            <input
              autoFocus
              aria-label="Ir ao arquivo"
              placeholder="Buscar no repositório…"
              value={quickQuery}
              onChange={(e) => setQuickQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && quickPaths[0]) {
                  navigate({ path: quickPaths[0].path, side, mode: "code" });
                  setQuick(false);
                }
              }}
            />
            <button
              aria-label="Fechar busca de arquivo"
              onClick={() => setQuick(false)}
            >
              ×
            </button>
          </header>
          <div>
            {quickPaths.map((e) => (
              <button
                key={e.path}
                onClick={() => {
                  navigate({ path: e.path, side, mode: "code" });
                  setQuick(false);
                }}
              >
                {e.path}
                {changed.has(e.path) && <span className="green">alterado</span>}
              </button>
            ))}
            {!quickPaths.length && <p>Nenhum arquivo encontrado.</p>}
          </div>
        </dialog>
      )}
    </div>
  );
}
