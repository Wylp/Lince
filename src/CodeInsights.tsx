import { useEffect, useRef, useState } from "react";
import { monaco, Project } from "./editor";
import type { TypeAlert, Location } from "./editor";
import type { ReviewProgress } from "./model";
import { ReviewBadge } from "./ReviewState";

export function CodeInsights({
  project,
  editor,
  review,
  navigate,
  currentEditor,
}: {
  project: Project;
  editor: monaco.editor.IStandaloneCodeEditor | null;
  review: ReviewProgress;
  navigate: (location: Location) => void;
  currentEditor: () => monaco.editor.IStandaloneCodeEditor | undefined;
}) {
  const [alerts, setAlerts] = useState<TypeAlert[]>([]);
  const [kind, setKind] = useState<"types" | "uses" | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] =
    useState<Awaited<ReturnType<Project["reviewUsages"]>>>();
  const [supported, setSupported] = useState(false);
  const [origin, setOrigin] = useState<Location | null>(null);
  const request = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (kind) dialog.current?.showModal();
  }, [kind]);
  useEffect(() => {
    let cancelled = false;
    let generation = 0;
    const load = async () => {
      const current = ++generation;
      const model = editor?.getModel();
      setAlerts([]);
      const ok =
        !!model && ["javascript", "typescript"].includes(model.getLanguageId());
      setSupported(ok);
      if (!ok || !model) return;
      try {
        const findings = await project.typeAlerts(model);
        if (!cancelled && current === generation && !model.isDisposed()) {
          setAlerts(findings);
          monaco.editor.setModelMarkers(
            model,
            "lince-types",
            findings.map((a) => ({
              startLineNumber: a.line,
              endLineNumber: a.line,
              startColumn: a.column,
              endColumn: a.column + a.name.length,
              severity: monaco.MarkerSeverity.Info,
              message: `Tipos possíveis: ${a.type}. Verifique o tratamento de cada caso; uma união não é necessariamente um erro.`,
            })),
          );
        }
      } catch {
        /* Explicit analysis can be retried from the panel. */
      }
    };
    void load();
    const sub = editor?.onDidChangeModel(() => void load());
    return () => {
      cancelled = true;
      request.current++;
      sub?.dispose();
    };
  }, [project, editor]);
  async function show(next: "types" | "uses") {
    const activeEditor = currentEditor();
    const model = activeEditor?.getModel(),
      position = activeEditor?.getPosition();
    if (!model || !position) return;
    const token = ++request.current;
    setOrigin(project.location(model.uri));
    setKind(next);
    setError("");
    setResult(undefined);
    setBusy(
      next === "types"
        ? "Analisando tipos inferidos…"
        : "Preparando busca de usos no snapshot local…",
    );
    try {
      if (next === "types") {
        const findings = await project.typeAlerts(model);
        if (token === request.current) setAlerts(findings);
      } else {
        const found = await project.reviewUsages(
          model,
          position,
          (text) => {
            if (token === request.current) setBusy(text);
          },
          () => token !== request.current,
        );
        if (token === request.current) setResult(found);
      }
    } catch (e) {
      if (token === request.current) setError(String(e));
    } finally {
      if (token === request.current) setBusy("");
    }
  }
  const uses = result?.entries ?? [];
  const paths = [
    ...new Set(
      uses
        .map((u) => project.location(u.uri)?.path)
        .filter((p): p is string => !!p),
    ),
  ];
  const changed =
    origin?.side === "head" ? paths.filter((path) => !!review.files[path]) : [];
  const close = () => {
    request.current++;
    setKind(null);
    setBusy("");
  };
  const read = changed.filter((path) => review.files[path].reviewed);
  return (
    <>
      <button
        disabled={!supported}
        onClick={() => void show("types")}
        title="Uniões de tipos inferidas em JS/TS, sem executar código"
      >
        Tipos{alerts.length ? ` (${alerts.length})` : ""}
      </button>
      <button
        disabled={!supported}
        onClick={() => void show("uses")}
        title="Posicione o cursor na função ou símbolo para buscar seus usos"
      >
        Usos e revisão
      </button>
      {kind && (
        <dialog
          ref={dialog}
          className="review-drafts code-insights"
          onCancel={close}
        >
          <header>
            <h3>
              {kind === "types"
                ? "Pontos de atenção nos tipos"
                : "Usos do símbolo e revisão"}
            </h3>
            <button onClick={close}>Fechar análise</button>
          </header>
          <p className="muted">
            {origin?.side.toUpperCase()} · {origin?.path}
          </p>
          {busy && <p role="status">{busy}</p>}
          {error && <p role="alert">Não foi possível analisar: {error}</p>}
          {!busy && !error && kind === "types" && (
            <>
              <p>
                Uma união indica possibilidades, não um erro confirmado. Confira
                o tratamento de cada tipo. Análise estática JS/TS; não executa o
                código.
              </p>
              <p className="muted">
                Dependências ausentes, any e valores recebidos em execução podem
                ocultar riscos. Até 200 declarações por arquivo.
              </p>
              {!alerts.length && (
                <p>
                  Nenhuma união entre categorias de tipos encontrada. Isso não
                  garante ausência de problemas.
                </p>
              )}
              {alerts.map((a) => (
                <button
                  className="insight-row"
                  key={`${a.line}:${a.column}`}
                  onClick={() => {
                    if (origin)
                      navigate({ ...origin, line: a.line, column: a.column });
                    setKind(null);
                  }}
                >
                  <strong>
                    {a.name} · linha {a.line}
                  </strong>
                  <code>{a.type}</code>
                </button>
              ))}
            </>
          )}
          {!busy && !error && kind === "uses" && result && (
            <>
              <p>
                {uses.length} ocorrências em {paths.length} arquivos.{" "}
                {read.length}/{changed.length} arquivos alterados com leitura
                registrada.
              </p>
              <p className="muted">
                Cobertura: {result.scanned}/{result.total} arquivos JS/TS lidos.
                Busca semântica com a configuração do arquivo de origem; usos
                dinâmicos, outras linguagens e configurações diferentes podem
                ficar de fora. Limite de 5.000 arquivos, 32 MiB e 20 segundos de
                leitura. Não é garantia de cobertura completa.
              </p>
              <p>
                A marcação é por arquivo, não por trecho. Discordâncias
                permanecem destacadas; “Não li” e “Aprovado sem ler” não contam
                como leitura. Arquivos fora do diff não têm revisão nesta PR.
              </p>
              {!uses.length && (
                <p>
                  Nenhum uso localizado nesse alcance. Posicione o cursor no
                  nome da função e tente novamente.
                </p>
              )}
              {uses.map((u, i) => {
                const loc = project.location(u.uri)!;
                const state =
                  origin?.side === "head" ? review.files[loc.path] : undefined;
                return (
                  <button
                    className="insight-row"
                    key={i}
                    onClick={() => {
                      navigate({
                        ...loc,
                        line: u.range.startLineNumber,
                        column: u.range.startColumn,
                      });
                      setKind(null);
                    }}
                  >
                    <span>
                      {loc.path}:{u.range.startLineNumber}
                    </span>
                    {state ? (
                      <span>
                        <ReviewBadge file={state} />{" "}
                        {state.decision === "disagree"
                          ? "Discordo"
                          : state.decision === "agree"
                            ? "Concordo"
                            : state.decision === "notRead"
                              ? "Não li"
                              : state.approvedUnread
                                ? "Aprovado sem ler"
                                : state.reviewed
                                  ? "Revisado"
                                  : "Pendente"}
                      </span>
                    ) : (
                      <small>
                        {origin?.side === "base"
                          ? "Base · sem estado de revisão do head"
                          : "Fora do diff"}
                      </small>
                    )}
                  </button>
                );
              })}
            </>
          )}
        </dialog>
      )}
    </>
  );
}
