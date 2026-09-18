import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { SearchSelect } from "./SearchSelect";
import { Avatar } from "./Avatar";
import { parseCodebases, ranked, schedule } from "./discovery";
import type {
  Repository,
  RepoActivity,
  RepoConfig,
  PullRequest,
  Page,
  ServiceLabels,
} from "./discovery";

function MonorepoSettings({
  repo,
  config,
  saved,
  close,
}: {
  repo: string;
  config?: RepoConfig;
  saved: (config: RepoConfig) => void;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [enabled, setEnabled] = useState(config?.monorepo ?? true);
  const [text, setText] = useState(
    config?.codebases.map((c) => `${c.path} = ${c.label}`).join("\n") ?? "",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function save() {
    setError("");
    setBusy(true);
    try {
      const next = { repo, monorepo: enabled, codebases: parseCodebases(text) };
      if (enabled && !next.codebases.length)
        throw new Error(
          "Configure pelo menos um serviço para identificar as PRs.",
        );
      await invoke("save_repo_config", { config: next });
      saved(next);
      close();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="monorepo-dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
      aria-labelledby="monorepo-title"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="dialog-heading">
          <div>
            <div className="eyebrow">CODEBASES</div>
            <h2 id="monorepo-title">Serviços do monorepo</h2>
            <p>{repo}</p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            aria-label="Fechar configuração"
          >
            ×
          </button>
        </div>
        <label className="mono-enable">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={busy}
          />{" "}
          Este repositório é um monorepo
        </label>
        <label htmlFor="service-paths">Caminhos e nomes dos serviços</label>
        <textarea
          id="service-paths"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          placeholder={
            "apps/api = API\napps/web = Web\npackages/auth = Autenticação"
          }
          rows={7}
          spellCheck={false}
        />
        <p className="config-hint">
          Uma linha por serviço: <code>pasta = Nome</code>. Inclui subpastas.
          Arquivos fora desses caminhos aparecem como “Fora das codebases”. A
          configuração fica neste dispositivo.
        </p>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" onClick={close} disabled={busy}>
            Cancelar
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Salvando…" : "Salvar configuração"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
function PrRow({
  pr,
  repo,
  config,
  codebase,
  open,
  opening,
}: {
  pr: PullRequest;
  repo: string;
  config?: RepoConfig;
  codebase: string;
  open: (url: string) => void;
  opening: boolean;
}) {
  const [labels, setLabels] = useState<ServiceLabels | null>(null),
    [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setLabels(null);
    setError("");
    if (!config?.monorepo) return;
    void schedule(
      () =>
        invoke<ServiceLabels>("get_service_labels", {
          repo,
          number: pr.number,
          headSha: pr.headSha,
          baseSha: pr.baseSha,
        }),
      () => current,
    )
      .then((value) => {
        if (current) setLabels(value);
      })
      .catch((e) => {
        if (current) setError(String(e));
      });
    return () => {
      current = false;
    };
  }, [repo, pr.number, pr.headSha, pr.baseSha, config, retry]);
  const matches =
    !codebase ||
    (codebase === "__outside__"
      ? labels?.outside
      : labels?.labels.includes(codebase));
  // Keep unknown/error rows visible: absence of a result must not imply no affected services.
  if (codebase && (!config?.monorepo || (labels && !matches))) return null;
  return (
    <article className="pr-card">
      <Avatar login={pr.author} size={34} />
      <div className="pr-card-main">
        <button
          className="pr-title"
          onClick={() => open(pr.url)}
          disabled={opening}
        >
          <span className={`pr-state ${pr.draft ? "draft" : ""}`}>
            {pr.draft ? "◇" : "⑂"}
          </span>
          {pr.title}
        </button>
        <div className="pr-card-meta">
          <span>#{pr.number}</span>
          <span>@{pr.author}</span>
          <time dateTime={pr.createdAt}>
            {new Date(pr.createdAt).toLocaleDateString("pt-BR")}
          </time>
          {pr.head && (
            <span title={`${pr.head} → ${pr.base}`} className="pr-branches">
              {pr.head} → {pr.base}
            </span>
          )}
          {pr.draft && <span className="draft-label">Rascunho</span>}
        </div>
        {config?.monorepo && (
          <div className="service-labels">
            {labels ? (
              <>
                {labels.labels.map((label) => (
                  <span key={label} className="service-label">
                    {label}
                  </span>
                ))}
                {labels.outside && (
                  <span className="service-label outside">
                    Fora das codebases
                  </span>
                )}
                {!labels.labels.length && !labels.outside && (
                  <span>Sem arquivos alterados</span>
                )}
              </>
            ) : error ? (
              <span className="service-error" title={error}>
                Serviços não identificados{" "}
                <button onClick={() => setRetry((n) => n + 1)}>
                  Tentar novamente
                </button>
              </span>
            ) : (
              <span className="service-loading">Identificando serviços…</span>
            )}
          </div>
        )}
      </div>
      <button
        className="pr-open"
        onClick={() => open(pr.url)}
        disabled={opening}
        aria-label={`Abrir PR #${pr.number} de ${repo}`}
      >
        Revisar ↗
      </button>
    </article>
  );
}
function RepoGroup({
  repo,
  activity,
  config,
  codebase,
  open,
  configure,
  opening,
  author,
  onAuthors,
  watching,
  toggleWatch,
}: {
  watching: boolean;
  toggleWatch: () => Promise<void>;
  author: string;
  onAuthors: (authors: string[]) => void;
  repo: Repository;
  activity?: RepoActivity;
  config?: RepoConfig;
  codebase: string;
  open: (url: string) => void;
  configure: () => void;
  opening: boolean;
}) {
  const [watchBusy, setWatchBusy] = useState(false),
    [watchError, setWatchError] = useState("");
  const [items, setItems] = useState<PullRequest[]>([]),
    [page, setPage] = useState(1),
    [more, setMore] = useState(false);
  const [warning, setWarning] = useState("");
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    void schedule(
      () =>
        invoke<Page<PullRequest>>("list_pull_requests", {
          repo: repo.name,
          author: author || null,
          page,
        }),
      () => current,
    )
      .then((result) => {
        if (!current) return;
        setItems((old) => [
          ...new Map(
            [...(page === 1 ? [] : old), ...result.items].map((pr) => [
              pr.number,
              pr,
            ]),
          ).values(),
        ]);
        setMore(result.hasMore);
        setWarning(result.warning ?? "");
        onAuthors(result.items.map((pr) => pr.author));
      })
      .catch((e) => {
        if (current) setError(String(e));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [repo.name, page, retry, author, onAuthors]);
  return (
    <section className="repo-group" aria-label={repo.name}>
      <header className="repo-group-header">
        <Avatar login={repo.owner} size={24} />
        <strong>{repo.name}</strong>
        {repo.private && <span className="repo-privacy">Privado</span>}
        {config?.monorepo && <span className="mono-badge">Monorepo</span>}
        {activity && (
          <span
            className="repo-frequent"
            title={
              activity.lastReviewedAt
                ? `${activity.sessions} sessões de revisão · última em ${new Date(activity.lastReviewedAt * 1000).toLocaleDateString("pt-BR")}`
                : "Revisões anteriores importadas; data não disponível"
            }
          >
            ↺{" "}
            {activity.lastReviewedAt ? "Revisado recentemente" : "Já revisado"}
          </span>
        )}
        <button
          className={`watch-toggle ${watching ? "active" : ""}`}
          disabled={watchBusy}
          aria-pressed={watching}
          aria-label={`Avisar novas PRs de ${repo.name}`}
          title="Notificações a cada 2 minutos com o Lince aberto"
          onClick={() => {
            setWatchBusy(true);
            setWatchError("");
            void toggleWatch()
              .catch((e) => setWatchError(String(e)))
              .finally(() => setWatchBusy(false));
          }}
        >
          {watchBusy
            ? "Salvando…"
            : watching
              ? "✓ Alertas ativos"
              : "♧ Avisar novas PRs"}
        </button>
        <button
          className="configure-repo"
          onClick={configure}
          aria-label={`Configurar codebases de ${repo.name}`}
        >
          ⚙ Codebases
        </button>
      </header>
      {watchError && (
        <p className="inline-error" role="alert">
          {watchError}
        </p>
      )}
      {items.map((pr) => (
        <PrRow
          key={pr.number}
          pr={pr}
          repo={repo.name}
          config={config}
          codebase={codebase}
          open={open}
          opening={opening}
        />
      ))}
      {warning && (
        <p className="inline-error" role="status">
          {warning}
        </p>
      )}
      {!loading && !error && !items.length && (
        <p className="repo-empty">Nenhuma PR aberta neste repositório.</p>
      )}
      {loading && (
        <p className="repo-empty" role="status">
          Carregando PRs…
        </p>
      )}
      {error && (
        <div className="inline-error" role="alert">
          {error}
          <button onClick={() => setRetry((n) => n + 1)}>
            Tentar novamente
          </button>
        </div>
      )}
      {more && !loading && !error && (
        <button className="load-more-prs" onClick={() => setPage((n) => n + 1)}>
          Carregar mais PRs de {repo.name}
        </button>
      )}
      {codebase && !!items.length && (
        <p className="filter-scope">
          Filtro de serviço aplicado às {items.length} PRs carregadas deste
          repositório.
        </p>
      )}
    </section>
  );
}
export function PrBrowser({
  watched,
  toggleWatch,
  open,
  back,
  opening,
}: {
  watched: string[];
  toggleWatch: (repo: string) => Promise<void>;
  open: (url: string) => void;
  back: () => void;
  opening: boolean;
}) {
  const [repos, setRepos] = useState<Repository[]>([]),
    [history, setHistory] = useState<RepoActivity[]>([]),
    [configs, setConfigs] = useState<RepoConfig[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true),
    [error, setError] = useState(""),
    [localError, setLocalError] = useState("");
  const [authors, setAuthors] = useState<string[]>([]);
  const onAuthors = useCallback(
    (next: string[]) =>
      setAuthors((old) => [...new Set([...old, ...next])].sort()),
    [],
  );
  const [refresh, setRefresh] = useState(0),
    [author, setAuthor] = useState(""),
    [repoName, setRepoName] = useState(""),
    [language, setLanguage] = useState(""),
    [codebase, setCodebase] = useState(""),
    [search, setSearch] = useState("");
  const [limit, setLimit] = useState(6),
    [editing, setEditing] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setRepos([]);
    setCatalogLoading(true);
    setError("");
    setLocalError("");
    if (!isTauri()) {
      setError("Abra o Lince desktop para listar suas PRs.");
      setCatalogLoading(false);
      return;
    }
    void Promise.allSettled([
      invoke<RepoActivity[]>("get_repo_activity"),
      invoke<RepoConfig[]>("get_repo_configs"),
    ]).then(([activity, settings]) => {
      if (!current) return;
      if (activity.status === "fulfilled") setHistory(activity.value);
      if (settings.status === "fulfilled") setConfigs(settings.value);
      const errors = [activity, settings]
        .filter((r) => r.status === "rejected")
        .map((r) => (r.status === "rejected" ? String(r.reason) : ""));
      if (errors.length) setLocalError(errors.join(" "));
    });
    void (async () => {
      for (let page = 1; page <= 1000 && current; page++) {
        const result = await invoke<Page<Repository>>("list_repositories", {
          page,
        });
        if (!current) return;
        setRepos((old) => [
          ...new Map(
            [...old, ...result.items].map((repo) => [repo.name, repo]),
          ).values(),
        ]);
        if (!result.hasMore) return;
      }
      if (current)
        throw new Error(
          "Catálogo acima de 100.000 repositórios; listagem parcial.",
        );
    })()
      .catch((e) => {
        if (current) setError(String(e));
      })
      .finally(() => {
        if (current) setCatalogLoading(false);
      });
    return () => {
      current = false;
    };
  }, [refresh]);
  useEffect(() => {
    setLimit(6);
  }, [author, repoName, language, codebase, search]);
  const filtered = useMemo(
    () =>
      ranked(repos, history).filter(
        (repo) =>
          (!repoName || repo.name === repoName) &&
          (!language || repo.language === language) &&
          repo.name.toLowerCase().includes(search.toLowerCase()) &&
          (!codebase ||
            configs.some(
              (c) =>
                c.repo === repo.name &&
                c.monorepo &&
                (codebase === "__outside__" ||
                  c.codebases.some((b) => b.label === codebase)),
            )),
      ),
    [repos, history, repoName, language, codebase, search, configs],
  );
  const languages = [
    ...new Set(repos.flatMap((r) => (r.language ? [r.language] : []))),
  ].sort();
  const services = [
    ...new Set(
      configs
        .filter((c) => c.monorepo && (!repoName || c.repo === repoName))
        .flatMap((c) => c.codebases.map((b) => b.label)),
    ),
  ].sort();
  return (
    <main className="pr-browser">
      <header className="browser-heading">
        <div>
          <div className="eyebrow">SEU ESPAÇO DE REVISÃO</div>
          <h1>Pull requests abertas</h1>
          <p>
            Seus repositórios mais revisados primeiro. Dentro de cada repo, as
            PRs mais novas.
          </p>
        </div>
        <div className="browser-actions">
          <button onClick={back}>← Voltar</button>
          <button
            onClick={() => setRefresh((n) => n + 1)}
            disabled={catalogLoading || opening}
          >
            ↻ Atualizar
          </button>
        </div>
      </header>
      <div className="browser-filters">
        <SearchSelect
          label="Autor da PR"
          value={author}
          onChange={setAuthor}
          allowLogin
          options={[
            { value: "", label: "Todos os autores" },
            ...authors.map((login) => ({
              value: login,
              label: `@${login}`,
              avatar: login,
            })),
          ]}
        />
        <SearchSelect
          label="Repositório"
          value={repoName}
          onChange={(value) => {
            setRepoName(value);
            setCodebase("");
          }}
          options={[
            { value: "", label: "Todos os repositórios" },
            ...ranked(repos, history).map((repo) => ({
              value: repo.name,
              label: repo.name,
              avatar: repo.owner,
            })),
          ]}
        />
        <SearchSelect
          label="Serviço / codebase"
          value={codebase}
          onChange={setCodebase}
          options={[
            { value: "", label: "Todas as codebases" },
            ...services.map((service) => ({ value: service, label: service })),
            { value: "__outside__", label: "Fora das codebases" },
          ]}
        />
        <SearchSelect
          label="Linguagem"
          value={language}
          onChange={setLanguage}
          options={[
            { value: "", label: "Todas as linguagens" },
            ...languages.map((language) => ({
              value: language,
              label: language,
            })),
          ]}
        />
        <label className="repo-search-label">
          Encontrar repositório
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nome ou organização…"
          />
        </label>
      </div>
      <div className="catalog-status">
        <span>
          {catalogLoading
            ? `Buscando repositórios… ${repos.length} encontrados`
            : `${repos.length} repositórios disponíveis`}{" "}
          · {Math.min(limit, filtered.length)} de {filtered.length} neste filtro
        </span>
        <span>Proprietário, colaborador ou membro da organização</span>
      </div>
      <div className="browser-results">
        {error && (
          <div className="banner error" role="alert">
            {error} {repos.length > 0 && "Catálogo parcial."}
            <button onClick={() => setRefresh((n) => n + 1)}>
              Tentar novamente
            </button>
          </div>
        )}
        {localError && (
          <div className="banner error" role="alert">
            Histórico ou codebases indisponíveis: {localError}
            <button onClick={() => setRefresh((n) => n + 1)}>
              Tentar novamente
            </button>
          </div>
        )}
        {filtered.slice(0, limit).map((repo) => (
          <RepoGroup
            key={`${refresh}:${repo.name}:${author}`}
            author={author}
            onAuthors={onAuthors}
            watching={watched.includes(repo.name)}
            toggleWatch={() => toggleWatch(repo.name)}
            repo={repo}
            activity={history.find(
              (h) => h.repo.toLowerCase() === repo.name.toLowerCase(),
            )}
            config={configs.find((c) => c.repo === repo.name)}
            codebase={codebase}
            open={open}
            opening={opening}
            configure={() => setEditing(repo.name)}
          />
        ))}
        {!filtered.length && !catalogLoading && !error && (
          <div className="notice">
            <h3>Nenhum repositório neste filtro</h3>
            <p>
              Confira os filtros e as permissões da conta conectada no GitHub.
            </p>
          </div>
        )}
        {limit < filtered.length && (
          <button
            className="load-more-repos"
            onClick={() => setLimit((n) => n + 6)}
          >
            Carregar mais repositórios ({filtered.length - limit} restantes)
          </button>
        )}
      </div>
      {editing && (
        <MonorepoSettings
          repo={editing}
          config={configs.find((c) => c.repo === editing)}
          close={() => setEditing(null)}
          saved={(config) =>
            setConfigs((old) => [
              ...old.filter((c) => c.repo !== config.repo),
              config,
            ])
          }
        />
      )}
    </main>
  );
}
