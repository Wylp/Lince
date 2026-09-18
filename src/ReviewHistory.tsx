import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Avatar } from "./Avatar";
import { SearchSelect } from "./SearchSelect";
interface Entry {
  key: string;
  reviewed: number;
  total: number;
  lastReviewedAt: number | null;
}
export function ReviewHistory({
  open,
  back,
  opening,
}: {
  open: (url: string) => void;
  back: () => void;
  opening: boolean;
}) {
  const [entries, setEntries] = useState<Entry[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [limit, setLimit] = useState(30);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    const request = isTauri()
      ? invoke<Entry[]>("get_review_history")
      : Promise.resolve([]);
    void request
      .then((rows) => {
        if (current) setEntries(rows);
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
  }, [retry]);
  const rows = entries.filter(
    (e) =>
      e.key.toLowerCase().includes(query.trim().toLowerCase()) &&
      (!status ||
        (status === "complete"
          ? e.total > 0 && e.reviewed === e.total
          : e.reviewed < e.total)),
  );
  return (
    <main className="pr-browser history-browser">
      <header className="browser-heading">
        <div>
          <div className="eyebrow">SEU RITMO DE REVISÃO</div>
          <h1>Histórico de revisões</h1>
          <p>Retome de onde parou. As últimas revisões aparecem primeiro.</p>
        </div>
        <button onClick={back} disabled={opening}>
          ← Voltar
        </button>
      </header>
      <div className="browser-filters">
        <label className="history-search">
          Encontrar PR
          <input
            placeholder="Repositório ou #número…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(30);
            }}
          />
        </label>
        <SearchSelect
          label="Progresso"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setLimit(30);
          }}
          options={[
            { value: "", label: "Todas as revisões" },
            { value: "pending", label: "Com arquivos pendentes" },
            { value: "complete", label: "Todos os arquivos revisados" },
          ]}
        />
      </div>
      <div className="catalog-status">
        <span>{rows.length} PRs no histórico local</span>
        <span>Progresso do último snapshot salvo · atualizado ao reabrir</span>
      </div>
      <div className="browser-results">
        {loading ? (
          <p role="status">Carregando histórico…</p>
        ) : error ? (
          <div className="banner error" role="alert">
            {error}
            <button onClick={() => setRetry((n) => n + 1)}>
              Tentar novamente
            </button>
          </div>
        ) : !rows.length ? (
          <div className="notice">
            <h3>
              {entries.length
                ? "Nenhuma revisão neste filtro"
                : "Seu histórico começa aqui"}
            </h3>
            <p>
              {entries.length
                ? "Tente outro repositório ou filtro."
                : "Abra uma PR para começar. Seu progresso ficará salvo neste dispositivo."}
            </p>
          </div>
        ) : (
          <>
            {rows.slice(0, limit).map((entry) => {
              const match = /^([^/#]+\/[^/#]+)#([1-9]\d*)$/.exec(entry.key);
              const repo = match?.[1],
                number = match?.[2];
              return (
                <article className="history-card" key={entry.key}>
                  {repo && <Avatar login={repo.split("/")[0]} size={36} />}
                  <div className="history-details">
                    <strong>
                      {repo ?? entry.key}
                      {number && ` · PR #${number}`}
                    </strong>
                    <span>
                      {entry.lastReviewedAt
                        ? `Última revisão: ${new Date(entry.lastReviewedAt * 1000).toLocaleString("pt-BR")}`
                        : "Data de revisão não registrada"}
                    </span>
                  </div>
                  <div className="history-progress">
                    <span>
                      {entry.reviewed} / {entry.total} arquivos revisados
                    </span>
                    <progress value={entry.reviewed} max={entry.total || 1} />
                  </div>
                  <button
                    disabled={opening || !repo}
                    onClick={() =>
                      open(`https://github.com/${repo}/pull/${number}`)
                    }
                    aria-label={`Retomar ${entry.key}`}
                  >
                    Retomar ↗
                  </button>
                </article>
              );
            })}
            {rows.length > limit && (
              <button
                className="load-more-prs"
                onClick={() => setLimit((n) => n + 30)}
              >
                Carregar mais revisões
              </button>
            )}
          </>
        )}
      </div>
    </main>
  );
}
