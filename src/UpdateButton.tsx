import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import type { Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type Phase =
  | "idle"
  | "checking"
  | "available"
  | "saving"
  | "downloading"
  | "installing"
  | "restarting"
  | "installed"
  | "error"
  | "disabled";
export function UpdateButton({
  flush,
  canInstall,
  lock,
}: {
  flush: () => Promise<void>;
  canInstall: boolean;
  lock: (busy: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle"),
    [version, setVersion] = useState(""),
    [message, setMessage] = useState("");
  const [progress, setProgress] = useState<{
    received: number;
    total?: number;
  }>({ received: 0 });
  const update = useRef<Update | null>(null),
    busy = useRef(false),
    enabled = useRef(false),
    lastCheck = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const [showDialog, setShowDialog] = useState(false);
  const verify = useCallback(async (manual = false) => {
    if (busy.current || !enabled.current) return;
    busy.current = true;
    setPhase("checking");
    if (manual) setMessage("");
    try {
      const result = await check({ timeout: 20000 });
      if (update.current) await update.current.close().catch(() => {});
      update.current = result;
      if (result) {
        setVersion(result.version);
        setPhase("available");
        setMessage(
          `Versão ${result.version} disponível. Clique para instalar.`,
        );
      } else {
        setPhase("idle");
        setMessage(
          manual
            ? "Você já está na versão mais recente."
            : "Verificar atualizações",
        );
      }
    } catch {
      // A transient check failure must not discard an already available update.
      setPhase(update.current ? "available" : "error");
      setMessage("Não foi possível verificar atualizações. Tente novamente.");
    } finally {
      busy.current = false;
      lastCheck.current = Date.now();
    }
  }, []);
  useEffect(() => {
    let current = true;
    if (!isTauri()) {
      setPhase("disabled");
      return;
    }
    void invoke<boolean>("updates_enabled")
      .then((value) => {
        if (current) {
          enabled.current = value;
          if (value) void verify();
          else setPhase("disabled");
        }
      })
      .catch(() => {
        if (current) {
          setPhase("error");
          setMessage("Não foi possível iniciar a verificação de atualizações.");
        }
      });
    const focus = () => {
      if (Date.now() - lastCheck.current > 60 * 60 * 1000) void verify();
    };
    const timer = window.setInterval(
      () => {
        void verify();
      },
      6 * 60 * 60 * 1000,
    );
    window.addEventListener("focus", focus);
    return () => {
      current = false;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [verify]);
  useEffect(() => {
    if (showDialog) dialog.current?.showModal();
  }, [showDialog]);
  async function install() {
    if (!update.current || busy.current || !canInstall) return;
    busy.current = true;
    lock(true);
    setShowDialog(true);
    setPhase("saving");
    setMessage("Salvando seu progresso…");
    setProgress({ received: 0 });
    let installed = false;
    try {
      await flush();
      setPhase("downloading");
      setMessage("Baixando a atualização assinada…");
      let received = 0;
      let total: number | undefined;
      await update.current.download((event) => {
        if (event.event === "Started") total = event.data.contentLength;
        if (event.event === "Progress") received += event.data.chunkLength;
        setProgress({ received, total });
      });
      // Progress must be durable before any installer can exit the process (Windows).
      await flush();
      setPhase("installing");
      setMessage("Verificando assinatura e instalando…");
      await update.current.install();
      installed = true;
      setPhase("restarting");
      setMessage("Atualização instalada. Reiniciando o Lince…");
      await relaunch();
    } catch (error) {
      if (installed) {
        setPhase("installed");
        setMessage(
          "A atualização foi instalada. Feche e abra o Lince para usar a nova versão.",
        );
      } else {
        setPhase("error");
        setMessage(
          `Não foi possível atualizar. Seu app atual continua disponível. ${String(error)}`,
        );
      }
      busy.current = false;
      lock(false);
    }
  }
  const installing = [
    "saving",
    "downloading",
    "installing",
    "restarting",
  ].includes(phase);
  const available = !!update.current && !installing && phase !== "installed";
  const title =
    phase === "disabled"
      ? "Atualizações automáticas estão habilitadas nos builds de release instalados."
      : message || "Verificar atualizações";
  return (
    <>
      <button
        className={`update-button ${available ? "available" : ""}`}
        disabled={
          phase === "checking" ||
          installing ||
          (available && !canInstall) ||
          phase === "disabled"
        }
        onClick={() => {
          if (available) void install();
          else void verify(true);
        }}
        title={title}
        aria-label={
          available
            ? `Atualizar Lince para ${version}`
            : "Verificar atualizações"
        }
      >
        {available
          ? `↑ Atualizar · ${version}`
          : phase === "checking"
            ? "Verificando…"
            : "↻"}{" "}
      </button>
      {phase === "error" && !showDialog && (
        <span className="update-check-error" role="status" title={message}>
          Falha ao verificar
        </span>
      )}
      {showDialog && (
        <dialog
          ref={dialog}
          className="update-dialog"
          aria-labelledby="update-title"
          onCancel={(e) => {
            e.preventDefault();
            if (!installing) setShowDialog(false);
          }}
        >
          <div className="eyebrow">LINCE · ATUALIZAÇÃO</div>
          <h2 id="update-title">
            {phase === "installed"
              ? "Atualização instalada"
              : `Versão ${version}`}
          </h2>
          <p role={phase === "error" ? "alert" : "status"}>{message}</p>
          {phase === "downloading" && (
            <>
              <progress
                max={progress.total || undefined}
                value={
                  progress.total
                    ? Math.min(progress.received, progress.total)
                    : undefined
                }
              />
              <small>
                {progress.total
                  ? `${Math.min(100, Math.round((progress.received / progress.total) * 100))}%`
                  : `${(progress.received / 1024 / 1024).toFixed(1)} MiB baixados`}
              </small>
            </>
          )}
          {phase === "error" && (
            <footer>
              <button onClick={() => setShowDialog(false)}>
                Voltar ao Lince
              </button>
              <button
                className="primary"
                onClick={() => {
                  void install();
                }}
              >
                Tentar novamente
              </button>
            </footer>
          )}
          {phase === "installed" && (
            <footer>
              <button onClick={() => setShowDialog(false)}>Fechar</button>
              <button
                className="primary"
                onClick={() => {
                  void flush()
                    .then(relaunch)
                    .catch(() =>
                      setMessage(
                        "Reinício automático indisponível. Feche e abra o Lince.",
                      ),
                    );
                }}
              >
                Reiniciar agora
              </button>
            </footer>
          )}
        </dialog>
      )}
    </>
  );
}
