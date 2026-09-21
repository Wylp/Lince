import { useEffect, useRef, useState } from "react";
export function AppSettings({
  focusMode,
  change,
  disabled,
}: {
  focusMode: boolean;
  change: (enabled: boolean) => Promise<void>;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  return (
    <>
      <button
        className="settings-button"
        aria-label="Configurações do aplicativo"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        ⚙
      </button>
      {open && (
        <dialog
          ref={dialog}
          className="review-drafts app-settings"
          onCancel={(e) => {
            if (busy) e.preventDefault();
            else setOpen(false);
          }}
        >
          <h3>Configurações</h3>
          <h4>Modo foco na revisão</h4>
          <p>
            Revise um arquivo por vez, na ordem da lista. Escolha Concordo,
            Discordo ou Não li para salvar sua decisão e seguir automaticamente
            ao próximo arquivo pendente.
          </p>
          <p>
            A troca de arquivos pela árvore, abas, busca, definições e atalhos
            fica bloqueada. Prévias de definições continuam disponíveis. Ações
            em lote ficam desativadas para não pular arquivos. Você pode sair do
            modo foco a qualquer momento.
          </p>
          <label className="focus-setting">
            <input
              type="checkbox"
              checked={focusMode}
              disabled={busy}
              onChange={(e) => {
                const value = e.target.checked;
                setBusy(true);
                setError("");
                void change(value)
                  .catch((e) => setError(String(e)))
                  .finally(() => setBusy(false));
              }}
            />{" "}
            Ativar modo foco
          </label>
          <p className="muted">
            As decisões ficam neste dispositivo. Concordar ou discordar de um
            arquivo não aprova nem solicita alterações na PR do GitHub. “Não li”
            também não significa aprovação.
          </p>
          {busy && <p role="status">Salvando preferência…</p>}
          {error && <p role="alert">{error}</p>}
          <footer>
            <button disabled={busy} onClick={() => setOpen(false)}>
              Fechar configurações
            </button>
          </footer>
        </dialog>
      )}
    </>
  );
}
