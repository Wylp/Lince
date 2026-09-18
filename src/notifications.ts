import { useCallback, useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
interface Watch {
  account: string;
  repo: string;
}
interface Status {
  checked: number;
  notified: number;
  errors: string[];
}
export function useNotifications(account: string | null | undefined) {
  const [watches, setWatches] = useState<Watch[]>([]),
    [error, setError] = useState(""),
    [status, setStatus] = useState(
      "Alertas a cada 2 minutos enquanto o Lince estiver aberto.",
    ),
    [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    setWatches(await invoke<Watch[]>("list_watches"));
  }, []);
  const receive = useCallback((s: Status) => {
    setError(s.errors.join("\n"));
    setStatus(
      `${s.checked} repositórios verificados · ${new Date().toLocaleTimeString("pt-BR")}`,
    );
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    void reload().catch((e) => setError(String(e)));
    const stop = listen<Status>("watch-status", (e) => receive(e.payload));
    return () => {
      void stop.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [account, reload, receive]);
  async function toggle(repo: string) {
    const enabled = !watches.some(
      (w) => w.account === account && w.repo === repo,
    );
    if (
      enabled &&
      !(await isPermissionGranted()) &&
      (await requestPermission()) !== "granted"
    )
      throw new Error(
        "Notificações bloqueadas. Permita o Lince nas configurações do sistema e tente novamente.",
      );
    await invoke("set_watch", { repo, enabled });
    await reload();
    setError("");
    setStatus("Alertas a cada 2 minutos enquanto o Lince estiver aberto.");
  }
  async function check() {
    if (busy) return;
    setBusy(true);
    try {
      receive(await invoke<Status>("poll_watches"));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return {
    watched: watches.filter((w) => w.account === account).map((w) => w.repo),
    toggle,
    check,
    busy,
    error,
    status,
  };
}
