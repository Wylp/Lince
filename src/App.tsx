import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { parseDiff } from "react-diff-view";
import { DiffPane } from "./DiffPane";
import { AuthStatus, useGhAuth } from "./AuthStatus";
import { Titlebar } from "./Titlebar";
import logo from "./assets/lince-logo.png";
import { UpdateButton } from "./UpdateButton";
import { PrBrowser } from "./PrBrowser";
import { Avatar } from "./Avatar";
import { FileTree } from "./FileTree";
import { emptyStore, reconcile, statusLabels } from "./model";
import type { FileDiff, ReviewProgress, Snapshot, Store } from "./model";

export default function App() {
  const { auth, refresh: refreshAuth } = useGhAuth();
  const [browsing, setBrowsing] = useState(false);
  const [url, setUrl] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [review, setReview] = useState<ReviewProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveState, setSaveState] = useState("Progresso local");
  const [info, setInfo] = useState("");
  const [filter, setFilter] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [diff, setDiff] = useState<{ key: string; data: FileDiff } | null>(
    null,
  );
  const [diffError, setDiffError] = useState("");
  const [retry, setRetry] = useState(0);
  const updateLocked = useRef(false);
  const store = useRef<Store>(emptyStore());
  const active = useRef<{ snapshot: Snapshot; review: ReviewProgress } | null>(
    null,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const dirty = useRef(false);
  const revision = useRef(0);
  const cache = useRef(new Map<string, FileDiff>());

  const flush = useCallback((): Promise<void> => {
    clearTimeout(timer.current);
    const current = active.current;
    if (!current || !dirty.current) return queue.current;
    dirty.current = false;
    const serial = revision.current;
    const args = {
      url: current.snapshot.url,
      key: current.snapshot.key,
      review: structuredClone(current.review),
    };
    setSaveState("Salvando…");
    const task = queue.current
      .catch(() => {})
      .then(() => invoke<void>("save_progress", args));
    queue.current = task;
    void task.then(
      () => {
        if (serial === revision.current) {
          setSaveState("Salvo neste dispositivo");
          setSaveError("");
        }
      },
      (err) => {
        dirty.current = true;
        setSaveState("Não salvo");
        setSaveError(String(err));
      },
    );
    return task;
  }, []);
  const update = useCallback(
    (next: ReviewProgress, immediate = false, render = true) => {
      if (!active.current) return;
      active.current.review = next;
      store.current.reviews[active.current.snapshot.key] = next;
      if (render) setReview(next);
      dirty.current = true;
      revision.current++;
      clearTimeout(timer.current);
      if (immediate) void flush().catch(() => {});
      else
        timer.current = setTimeout(() => {
          void flush().catch(() => {});
        }, 300);
    },
    [flush],
  );

  async function open(input: string) {
    if (!isTauri()) {
      setError(
        "Abra o aplicativo desktop com npm run tauri dev. A integração gh é executada pelo backend Rust.",
      );
      return;
    }
    setLoading(true);
    setError("");
    setInfo("");
    try {
      await flush();
      const next = await invoke<Snapshot>("open_pr", { url: input });
      const restored = reconcile(next, store.current.reviews[next.key]);
      active.current = { snapshot: next, review: restored.review };
      setSnapshot(next);
      setBrowsing(false);
      setUrl(next.url);
      setFilter("");
      setPendingOnly(false);
      setDiff(null);
      setDiffError("");
      if (restored.invalidated)
        setInfo(
          `${restored.invalidated} arquivo(s) mudou/mudaram e voltou/voltaram a ficar pendente(s).`,
        );
      update(restored.review, true);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let disposed = false;
    if (!isTauri()) {
      setReady(true);
      return;
    }
    void invoke<Store>("load_progress")
      .then((saved) => {
        if (disposed) return;
        store.current = saved;
        setUrl(saved.lastUrl);
        setReady(true);
        if (saved.lastUrl) void open(saved.lastUrl);
      })
      .catch((err) => {
        if (!disposed) {
          setSaveError(String(err));
          setReady(true);
        }
      });
    const onBlur = () => {
      void flush().catch(() => {});
    };
    window.addEventListener("blur", onBlur);
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      if (updateLocked.current) return;
      try {
        await flush();
        await getCurrentWindow().destroy();
      } catch {
        setSaveError(
          "Não foi possível salvar. A janela continua aberta; tente salvar novamente antes de fechar.",
        );
      }
    });
    return () => {
      disposed = true;
      window.removeEventListener("blur", onBlur);
      void unlisten.then((fn) => fn());
      clearTimeout(timer.current);
    };
    // Initialization only. Open uses the current progress refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const file = snapshot?.files.find((f) => f.path === review?.selected);
  const diffKey = snapshot && file ? `${snapshot.id}\0${file.path}` : "";
  useEffect(() => {
    if (!snapshot || !file) return;
    let stale = false;
    setDiffError("");
    const saved = cache.current.get(diffKey);
    if (saved) {
      setDiff({ key: diffKey, data: saved });
      return;
    }
    setDiff(null);
    void invoke<FileDiff>("get_diff", {
      snapshotId: snapshot.id,
      path: file.path,
    })
      .then((data) => {
        if (data.patch) {
          try {
            if (!parseDiff(data.patch)[0]?.hunks.length)
              throw new Error("empty");
          } catch {
            data = {
              patch: null,
              reason:
                "Não foi possível interpretar o diff completo. Revisão desabilitada.",
              reviewable: false,
            };
          }
        }
        if (cache.current.size >= 20)
          cache.current.delete(cache.current.keys().next().value!);
        cache.current.set(diffKey, data);
        if (!stale) {
          setDiff({ key: diffKey, data });
          if (
            !data.reviewable &&
            active.current?.review.files[file.path]?.reviewed
          ) {
            const current = active.current.review;
            update(
              {
                ...current,
                files: {
                  ...current.files,
                  [file.path]: { ...current.files[file.path], reviewed: false },
                },
              },
              true,
            );
          }
        }
      })
      .catch((err) => {
        if (!stale) setDiffError(String(err));
      });
    return () => {
      stale = true;
    };
  }, [diffKey, retry]);

  const select = (path: string) => {
    const current = active.current;
    if (current) update({ ...current.review, selected: path }, true);
  };
  const visible =
    snapshot?.files.filter(
      (f) =>
        f.path.toLowerCase().includes(filter.toLowerCase()) &&
        (!pendingOnly || !review?.files[f.path]?.reviewed),
    ) ?? [];
  const count = review
    ? Object.values(review.files).filter((f) => f.reviewed).length
    : 0;
  const total = snapshot?.files.length ?? 0;
  const data = diff?.key === diffKey ? diff.data : null;
  const index = snapshot?.files.findIndex((f) => f.path === file?.path) ?? -1;
  const move = (direction: number) => {
    const next = snapshot?.files[index + direction];
    if (next) select(next.path);
  };

  return (
    <div className="app">
      <Titlebar
        context={
          snapshot ? `${snapshot.repo} / PR #${snapshot.number}` : undefined
        }
        onError={setError}
        updateControl={
          <UpdateButton
            flush={flush}
            canInstall={ready && !loading}
            lock={(busy) => {
              updateLocked.current = busy;
            }}
          />
        }
      />
      <header className="topbar">
        <button
          className="brand brand-home"
          aria-label="Voltar para a home do Lince"
          disabled={loading || !ready}
          onClick={() => {
            void flush()
              .then(() => {
                active.current = null;
                setSnapshot(null);
                setReview(null);
                setDiff(null);
                setBrowsing(false);
                setError("");
                setInfo("");
              })
              .catch((e) => setError(String(e)));
          }}
        >
          <img className="brand-mark" src={logo} alt="" /> lince
          <span className="preview-badge">PREVIEW</span>
        </button>
        <form
          className="open-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!loading && ready) void open(url);
          }}
        >
          <label className="sr-only" htmlFor="pr-url">
            URL da pull request
          </label>
          <span className="url-icon">↗</span>
          <input
            id="pr-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo/pull/123"
            required
            spellCheck={false}
            disabled={loading || !ready}
          />
          <button className="primary" disabled={loading || !ready}>
            {loading ? "Abrindo…" : "Abrir PR"}
            <span>↵</span>
          </button>
        </form>
        <button
          className={`browse-button ${browsing ? "active" : ""}`}
          onClick={() => {
            void flush()
              .then(() => setBrowsing(true))
              .catch((e) => setError(String(e)));
          }}
          disabled={loading || !ready}
        >
          ☷ Listar PRs
        </button>
        <AuthStatus auth={auth} refresh={refreshAuth} compact />
      </header>
      {error && (
        <div className="banner error" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="Dispensar erro">
            ×
          </button>
        </div>
      )}
      {saveError && (
        <div className="banner error" role="alert">
          {saveError}
          <button
            onClick={() => {
              void flush().catch(() => {});
            }}
          >
            Tentar salvar
          </button>
        </div>
      )}
      {info && (
        <div className="banner" role="status">
          {info}
        </div>
      )}
      {browsing ? (
        <PrBrowser
          open={(input) => {
            void open(input);
          }}
          back={() => setBrowsing(false)}
          opening={loading}
        />
      ) : snapshot && review ? (
        <>
          <section className="pr-header">
            <div>
              <div className="eyebrow">
                {snapshot.repo} <span>/ PULL REQUEST #{snapshot.number}</span>
              </div>
              <h1>{snapshot.title}</h1>
              <div className="pr-meta">
                <span className="author-identity">
                  <Avatar login={snapshot.author} size={22} />@{snapshot.author}
                </span>
                <span className="branch">{snapshot.headBranch}</span>
                <span>→</span>
                <span className="branch">{snapshot.baseBranch}</span>
                <span
                  title={`Base comum: ${snapshot.mergeBase}\nHead: ${snapshot.headSha}`}
                >
                  snapshot {snapshot.headSha.slice(0, 7)}
                </span>
              </div>
            </div>
            <div className="progress-summary">
              <strong>
                {count}
                <span> / {total}</span>
              </strong>
              <span>arquivos revisados</span>
              <progress value={count} max={total || 1} />
            </div>
          </section>
          <div className="workspace" aria-busy={loading}>
            <aside className="sidebar">
              <div className="sidebar-heading">
                <strong>Arquivos alterados</strong>
                <span>{total}</span>
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
              <label className="pending-filter">
                <input
                  type="checkbox"
                  checked={pendingOnly}
                  onChange={(e) => setPendingOnly(e.target.checked)}
                />{" "}
                Apenas pendentes <span>{total - count}</span>
              </label>
              <div className="tree-scroll">
                <FileTree files={visible} progress={review} select={select} />
                {!visible.length && (
                  <p className="empty-tree">
                    {total
                      ? "Nenhum arquivo neste filtro."
                      : "Esta PR não tem arquivos alterados."}
                  </p>
                )}
              </div>
              <div className="sidebar-footer">
                <span className="green">✓ {count} revisados</span>
                <span>{total - count} pendentes</span>
              </div>
            </aside>
            <main className="reader">
              {file ? (
                <>
                  <div className="file-header">
                    <div className="file-heading">
                      <span className={`file-tag ${file.status}`}>
                        {statusLabels[file.status] ?? file.status}
                      </span>
                      <strong title={file.path}>{file.path}</strong>
                      {file.previousPath && (
                        <small>antes: {file.previousPath}</small>
                      )}
                    </div>
                    <div className="file-actions">
                      <span className="green">+{file.additions}</span>
                      <span className="red">−{file.deletions}</span>
                      <label
                        className={`review-toggle ${review.files[file.path]?.reviewed ? "checked" : ""}`}
                      >
                        <input
                          type="checkbox"
                          aria-label="Marcar arquivo como revisado"
                          disabled={!data?.reviewable || loading}
                          checked={review.files[file.path]?.reviewed ?? false}
                          onChange={(e) => {
                            const current = active.current!.review;
                            update(
                              {
                                ...current,
                                files: {
                                  ...current.files,
                                  [file.path]: {
                                    ...current.files[file.path],
                                    reviewed: e.target.checked,
                                  },
                                },
                              },
                              true,
                            );
                          }}
                        />{" "}
                        Revisado
                      </label>
                    </div>
                  </div>
                  <div className="diff-labels">
                    <span>
                      BASE COMUM <code>{snapshot.mergeBase.slice(0, 7)}</code>
                    </span>
                    <span>
                      ALTERAÇÕES DA PR{" "}
                      <code>{snapshot.headSha.slice(0, 7)}</code>
                    </span>
                  </div>
                  {diffError ? (
                    <div className="notice" role="alert">
                      <h3>Não foi possível carregar o arquivo</h3>
                      <p>{diffError}</p>
                      <button onClick={() => setRetry((n) => n + 1)}>
                        Tentar novamente
                      </button>
                    </div>
                  ) : data ? (
                    <DiffPane
                      key={diffKey}
                      data={data}
                      position={review.files[file.path]}
                      onScroll={(top, left) => {
                        const current = active.current;
                        if (
                          !current ||
                          current.snapshot.id !== snapshot.id ||
                          current.review.selected !== file.path
                        )
                          return;
                        const previous = current.review.files[file.path];
                        if (previous.top === top && previous.left === left)
                          return;
                        update(
                          {
                            ...current.review,
                            files: {
                              ...current.review.files,
                              [file.path]: { ...previous, top, left },
                            },
                          },
                          false,
                          false,
                        );
                      }}
                    />
                  ) : (
                    <div className="notice" role="status">
                      <span className="spinner" />
                      <p>Carregando conteúdo completo do arquivo…</p>
                    </div>
                  )}
                  <footer className="reader-footer">
                    <span>
                      Arquivo {index + 1} de {total} · diff acumulado
                    </span>
                    <div>
                      <button
                        aria-label="Arquivo anterior"
                        disabled={index <= 0}
                        onClick={() => move(-1)}
                      >
                        ← Anterior
                      </button>
                      <button
                        aria-label="Próximo arquivo"
                        disabled={index >= total - 1}
                        onClick={() => move(1)}
                      >
                        Próximo →
                      </button>
                    </div>
                  </footer>
                </>
              ) : (
                <div className="notice">
                  <h3>Nenhum arquivo alterado</h3>
                </div>
              )}
            </main>
          </div>
          <footer className="statusbar">
            <span>{saveState}</span>
            <span>Posição de leitura preservada por arquivo</span>
            <span>Somente leitura no GitHub</span>
          </footer>
        </>
      ) : (
        <main className="welcome">
          <img className="welcome-symbol" src={logo} alt="Logo do Lince" />
          <div className="eyebrow">MENOS SCROLL. MAIS CONTEXTO.</div>
          <h1>
            Veja cada mudança.
            <br />
            <span>No seu ritmo.</span>
          </h1>
          <p>
            Abra uma pull request para revisar um arquivo por vez.
            <br />
            Seu contexto e seu progresso ficam com você.
          </p>
          <div className="welcome-features">
            <span>▱ Árvore sempre visível</span>
            <span>↔ Diff lado a lado</span>
            <span>✓ Progresso salvo</span>
          </div>
          <AuthStatus auth={auth} refresh={refreshAuth} />
          {loading && (
            <p role="status">Consultando metadados e arquivos da PR…</p>
          )}
        </main>
      )}
    </div>
  );
}
