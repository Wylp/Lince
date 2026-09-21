import { useEffect, useState } from "react";
export interface LoadingStep {
  id: string;
  title: string;
  detail: string;
}
export const prLoadingSteps: LoadingStep[] = [
  {
    id: "save",
    title: "Guardar seu progresso",
    detail: "Salvando a revisão atual neste dispositivo.",
  },
  {
    id: "github",
    title: "Consultar a PR",
    detail:
      "Buscando informações e arquivos alterados no GitHub com sua sessão do gh.",
  },
  {
    id: "base",
    title: "Preparar a versão original",
    detail: "Conferindo os arquivos da base no cache local.",
  },
  {
    id: "head",
    title: "Preparar a versão da PR",
    detail: "Conferindo os arquivos novos no cache local.",
  },
  {
    id: "tree",
    title: "Organizar os arquivos",
    detail:
      "Lendo a árvore do repositório para permitir a navegação pelo código.",
  },
  {
    id: "diff",
    title: "Calcular as alterações",
    detail: "Comparando as versões completas dos arquivos alterados.",
  },
];
export const editorLoadingSteps: LoadingStep[] = [
  {
    id: "files",
    title: "Carregar o espaço de revisão",
    detail: "Organizando os diffs e a árvore de arquivos já preparados.",
  },
  {
    id: "editor",
    title: "Preparar o editor",
    detail: "Iniciando o realce de código e a navegação para definições.",
  },
];
export function LoadingState({
  title,
  detail,
  steps,
  active = 0,
  compact = false,
}: {
  title: string;
  detail?: string;
  steps?: LoadingStep[];
  active?: number;
  compact?: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  const current = steps?.[active];
  return (
    <section
      className={`loading-state ${compact ? "compact" : ""}`}
      aria-label={title}
      aria-busy="true"
    >
      <div className="loading-state-heading">
        <span className="spinner" aria-hidden="true" />
        <h2>{title}</h2>
        <span className="loading-elapsed" aria-hidden="true">
          {elapsed}s
        </span>
      </div>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="loading-description"
      >
        {current && <strong>{current.title}</strong>}
        <p>{detail || current?.detail}</p>
      </div>
      {steps && (
        <ol className="loading-steps" aria-label="Etapas do carregamento">
          {steps.map((step, index) => (
            <li
              key={step.id}
              className={
                index < active
                  ? "complete"
                  : index === active
                    ? "active"
                    : "waiting"
              }
              aria-current={index === active ? "step" : undefined}
            >
              <span className="loading-step-mark" aria-hidden="true">
                {index < active ? "✓" : index + 1}
              </span>
              <span>{step.title}</span>
              <span className="sr-only">
                {index < active
                  ? "Concluída"
                  : index === active
                    ? "Em andamento"
                    : "Aguardando"}
              </span>
            </li>
          ))}
        </ol>
      )}
      {elapsed >= 12 && (
        <p className="loading-patience">
          Ainda em andamento. O tempo depende do tamanho da PR, do cache local e
          da conexão.
        </p>
      )}
    </section>
  );
}
