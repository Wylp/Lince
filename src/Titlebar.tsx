import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import logo from "./assets/lince-logo.png";
export function Titlebar({
  context,
  onError,
  updateControl,
}: {
  context?: string;
  updateControl?: React.ReactNode;
  onError: (message: string) => void;
}) {
  const mac = /Mac/i.test(navigator.platform);
  const action = (name: "minimize" | "toggleMaximize" | "close") => {
    if (isTauri())
      void getCurrentWindow()
        [name]()
        .catch(() =>
          onError("Não foi possível controlar a janela. Tente novamente."),
        );
  };
  return (
    <div className={`titlebar ${mac ? "mac" : ""}`} data-tauri-drag-region>
      <div className="titlebar-identity" data-tauri-drag-region>
        <img src={logo} alt="" draggable={false} />
        <span data-tauri-drag-region>Lince</span>
        <span className="titlebar-divider" />
        <span className="titlebar-mode" data-tauri-drag-region>
          REVIEW WORKSPACE
        </span>
      </div>
      <div className="titlebar-context" data-tauri-drag-region>
        {context ?? "Veja cada mudança. Mantenha o contexto."}
      </div>
      <div className="titlebar-end" data-tauri-drag-region>
        {updateControl}
        <span className="titlebar-local" data-tauri-drag-region>
          LOCAL
        </span>
        {!mac && (
          <div className="window-controls">
            <button
              aria-label="Minimizar janela"
              onClick={() => action("minimize")}
            >
              −
            </button>
            <button
              aria-label="Maximizar ou restaurar janela"
              onClick={() => action("toggleMaximize")}
            >
              □
            </button>
            <button
              className="window-close"
              aria-label="Fechar janela"
              onClick={() => action("close")}
            >
              ×
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
