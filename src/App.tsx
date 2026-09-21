import { AppSettings } from "./AppSettings";
import { LoadingState, prLoadingSteps } from "./LoadingState";
import { useNotifications } from "./notifications";
import { ReviewHistory } from "./ReviewHistory";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
const CodeWorkspace = lazy(() => import("./CodeWorkspace"));
import { AuthStatus, useGhAuth } from "./AuthStatus";
import { Titlebar } from "./Titlebar";
import logo from "./assets/lince-logo.png";
import { UpdateButton } from "./UpdateButton";
import { PrBrowser } from "./PrBrowser";
import { Avatar } from "./Avatar";
import { emptyStore, reconcile, applyDecision } from "./model";
import type { ReviewProgress, Snapshot, Store } from "./model";

export default function App() {
  const { auth, refresh: refreshAuth } = useGhAuth();
  const notifications = useNotifications(auth.login);
  const [browsing, setBrowsing] = useState(false);
  const [url, setUrl] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [review, setReview] = useState<ReviewProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState({ active: 0, detail: "" });
  const opening = useRef(false);
  const [ready, setReady] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const changeFocusMode = async (enabled: boolean) => {
    await invoke("set_focus_mode", { enabled });
    setFocusMode(enabled);
  };
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveState, setSaveState] = useState("Progresso local");
  const [info, setInfo] = useState("");
  const updateLocked = useRef(false);
  const store = useRef<Store>(emptyStore());
  const active = useRef<{ snapshot: Snapshot; review: ReviewProgress } | null>(
    null,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const dirty = useRef(false);
  const revision = useRef(0);

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
    if (opening.current) return;
    opening.current = true;
    setLoadProgress({ active: 0, detail: "" });
    setLoading(true);
    setError("");
    setInfo("");
    let current = true;
    const channel = new Channel<{ step: string; detail: string }>((event) => {
      if (!current) return;
      const index = prLoadingSteps.findIndex((step) => step.id === event.step);
      if (index >= 0)
        setLoadProgress((old) =>
          index >= old.active ? { active: index, detail: event.detail } : old,
        );
    });
    try {
      await flush();
      setLoadProgress({ active: 1, detail: "" });
      const next = await invoke<Snapshot>("open_pr", {
        url: input,
        onProgress: channel,
      });
      const restored = reconcile(next, store.current.reviews[next.key]);
      active.current = { snapshot: next, review: restored.review };
      setSnapshot(next);
      setBrowsing(false);
      setHistoryOpen(false);
      setUrl(next.url);
      if (restored.invalidated)
        setInfo(
          `${restored.invalidated} arquivo(s) mudou/mudaram e voltou/voltaram a ficar pendente(s).`,
        );
      update(restored.review, true);
    } catch (err) {
      setError(String(err));
    } finally {
      current = false;
      opening.current = false;
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
        setFocusMode(saved.focusMode ?? false);
        setReady(true);
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

  const select = (path: string) => {
    const current = active.current;
    if (current) update({ ...current.review, selected: path }, true);
  };
  const count = review
    ? Object.values(review.files).filter((f) => f.reviewed).length
    : 0;
  const approvedUnread = review
    ? Object.values(review.files).filter((f) => f.approvedUnread).length
    : 0;
  const notRead = review
    ? Object.values(review.files).filter((f) => f.decision === "notRead").length
    : 0;
  const disagreed = review
    ? Object.values(review.files).filter((f) => f.decision === "disagree")
        .length
    : 0;
  const total = snapshot?.files.length ?? 0;

  return (
    <div
      className={`app ${snapshot && review && !browsing && !historyOpen ? "reviewing" : ""}`}
    >
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
        <AppSettings
          focusMode={focusMode}
          change={changeFocusMode}
          disabled={loading || !ready}
        />
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
                setBrowsing(false);
                setHistoryOpen(false);
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
              .then(() => {
                setHistoryOpen(false);
                setBrowsing(true);
              })
              .catch((e) => setError(String(e)));
          }}
          disabled={loading || !ready}
        >
          ☷ Listar PRs
        </button>
        <button
          className={`browse-button ${historyOpen ? "active" : ""}`}
          disabled={loading || !ready}
          onClick={() => {
            void flush()
              .then(() => {
                setBrowsing(false);
                setHistoryOpen(true);
              })
              .catch((e) => setError(String(e)));
          }}
        >
          ↺ Histórico
        </button>
        <button
          className="notification-status"
          aria-label="Verificar alertas de novas PRs"
          disabled={notifications.busy || !notifications.watched.length}
          title={notifications.error || notifications.status}
          onClick={() => {
            void notifications.check();
          }}
        >
          ♧ {notifications.watched.length} alertas
        </button>
        <AuthStatus auth={auth} refresh={refreshAuth} compact />
      </header>
      {notifications.error && (
        <div className="banner error" role="alert">
          Alertas: {notifications.error}
        </div>
      )}
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
      {(!ready || loading) && (
        <div className="loading-overlay">
          <LoadingState
            title={!ready ? "Abrindo o Lince" : "Preparando sua revisão"}
            steps={ready ? prLoadingSteps : undefined}
            active={loadProgress.active}
            detail={
              !ready
                ? "Restaurando suas preferências e o progresso salvo neste dispositivo."
                : loadProgress.detail
            }
          />
        </div>
      )}
      {historyOpen ? (
        <ReviewHistory
          open={(input) => {
            void open(input);
          }}
          back={() => setHistoryOpen(false)}
          opening={loading}
        />
      ) : browsing ? (
        <PrBrowser
          watched={notifications.watched}
          toggleWatch={notifications.toggle}
          open={(input) => {
            void open(input);
          }}
          back={() => setBrowsing(false)}
          opening={loading}
        />
      ) : snapshot && review ? (
        <>
          <section className="pr-header compact-pr-header">
            <span className="pr-number" title={snapshot.repo}>
              {snapshot.repo} #{snapshot.number}
            </span>
            <h1 title={snapshot.title}>{snapshot.title}</h1>
            <details className="pr-details">
              <summary
                aria-label="Detalhes da PR"
                title="Autor, branches e commits"
              >
                Detalhes
              </summary>
              <div className="pr-details-popover">
                <span className="author-identity">
                  <Avatar login={snapshot.author} size={22} />@{snapshot.author}
                </span>
                <span>
                  {snapshot.headBranch} → {snapshot.baseBranch}
                </span>
                <span>
                  Base comum: {snapshot.mergeBase.slice(0, 7)} · Head:{" "}
                  {snapshot.headSha.slice(0, 7)}
                </span>
              </div>
            </details>
            <button
              disabled={loading}
              onClick={() => {
                void open(snapshot.url);
              }}
              title="Consultar novos commits e sincronizar o cache local"
              aria-label="Atualizar PR"
            >
              ↻
            </button>
            <div
              className="progress-summary"
              title={`${count} vistos, ${approvedUnread} aprovados sem ler, ${notRead} não lidos, ${disagreed} discordâncias, ${total - count - approvedUnread - notRead} pendentes`}
            >
              <span>
                <strong>{count}</strong> / {total} revisados
                {approvedUnread > 0 && ` · ${approvedUnread} sem ler`}
                {notRead > 0 && ` · ${notRead} não lidos`}
                {disagreed > 0 && ` · ${disagreed} discordâncias`}
              </span>
              <progress
                aria-label="Progresso da revisão"
                value={count + approvedUnread + notRead}
                max={total || 1}
              />
            </div>
          </section>
          <Suspense
            fallback={
              <div className="workspace-loading">
                <LoadingState
                  title="Abrindo o editor"
                  detail="Carregando as ferramentas de leitura e navegação do código."
                />
              </div>
            }
          >
            <CodeWorkspace
              key={snapshot.id}
              snapshot={snapshot}
              review={review}
              loading={loading}
              focusMode={focusMode}
              exitFocus={() => changeFocusMode(false)}
              select={select}
              mark={async (paths, decision) => {
                const current = active.current;
                if (!current) return;
                const previous = current.review.files;
                const files = { ...previous };
                for (const path of paths) {
                  if (files[path])
                    files[path] = applyDecision(files[path], decision);
                }
                update({ ...current.review, files }, true);
                try {
                  await flush();
                } catch (error) {
                  if (active.current === current) {
                    const restored = { ...current.review.files };
                    for (const path of paths)
                      if (restored[path] && previous[path])
                        restored[path] = {
                          ...restored[path],
                          reviewed: previous[path].reviewed,
                          approvedUnread: previous[path].approvedUnread,
                          decision: previous[path].decision,
                        };
                    update({ ...current.review, files: restored }, false);
                  }
                  throw error;
                }
              }}
              saveScroll={(path, top, left) => {
                const current = active.current;
                if (
                  current &&
                  current.snapshot.id === snapshot.id &&
                  current.review.files[path]
                ) {
                  const old = current.review.files[path];
                  if (old.top !== top || old.left !== left)
                    update(
                      {
                        ...current.review,
                        files: {
                          ...current.review.files,
                          [path]: { ...old, top, left },
                        },
                      },
                      false,
                      false,
                    );
                }
              }}
            />
          </Suspense>
          <footer className="statusbar">
            <span>{saveState}</span>
            <span>Posição de leitura preservada por arquivo</span>
            <span>Código somente leitura · comentários no GitHub</span>
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
        </main>
      )}
    </div>
  );
}
