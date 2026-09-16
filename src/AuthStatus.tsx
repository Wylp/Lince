import { Avatar } from "./Avatar";
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
export interface GhAuth {
  state:
    | "authenticated"
    | "signedOut"
    | "missing"
    | "unavailable"
    | "checking"
    | "desktopOnly";
  login: string | null;
  message: string;
}
export function useGhAuth() {
  const [auth, setAuth] = useState<GhAuth>({
    state: "checking",
    login: null,
    message: "Verificando sua conta no GitHub…",
  });
  const busy = useRef(false);
  const mounted = useRef(true);
  const lastCheck = useRef(0);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    if (!isTauri()) {
      setAuth({
        state: "desktopOnly",
        login: null,
        message: "Abra o Lince desktop para verificar sua conta.",
      });
      return;
    }
    busy.current = true;
    setAuth({
      state: "checking",
      login: null,
      message: "Verificando sua conta no GitHub…",
    });
    try {
      const result = await invoke<GhAuth>("get_auth_status");
      if (mounted.current) setAuth(result);
    } catch {
      if (mounted.current)
        setAuth({
          state: "unavailable",
          login: null,
          message: "Não foi possível verificar sua conta. Tente novamente.",
        });
    } finally {
      busy.current = false;
      lastCheck.current = Date.now();
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onFocus = () => {
      if (Date.now() - lastCheck.current > 15000) void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);
  return { auth, refresh };
}
const titles: Record<GhAuth["state"], string> = {
  authenticated: "GitHub conectado",
  signedOut: "GitHub desconectado",
  missing: "GitHub CLI não encontrado",
  unavailable: "Conexão não verificada",
  checking: "Verificando GitHub",
  desktopOnly: "Disponível no desktop",
};
export function AuthStatus({
  auth,
  refresh,
  compact = false,
}: {
  auth: GhAuth;
  refresh: () => void;
  compact?: boolean;
}) {
  if (compact)
    return (
      <button
        className={`auth-badge ${auth.state}`}
        onClick={refresh}
        disabled={auth.state === "checking"}
        title={`${auth.message} Clique para verificar novamente.`}
        aria-label="Verificar conexão com GitHub"
      >
        {auth.login ? <Avatar login={auth.login} size={20} /> : <i />}
        {auth.state === "authenticated" ? `@${auth.login}` : titles[auth.state]}
      </button>
    );
  return (
    <section className={`auth-card ${auth.state}`} aria-label="Conta do GitHub">
      <div className="auth-card-icon" aria-hidden="true">
        {auth.login ? (
          <Avatar login={auth.login} size={34} />
        ) : auth.state === "checking" ? (
          "…"
        ) : (
          "↗"
        )}
      </div>
      <div className="auth-card-copy" aria-live="polite">
        <strong>
          {titles[auth.state]}
          {auth.login && <span> @{auth.login}</span>}
        </strong>
        <p>{auth.message}</p>
        {auth.state === "signedOut" && (
          <code>gh auth login --hostname github.com</code>
        )}
        {auth.state === "missing" && (
          <p>Instale o GitHub CLI e reabra o Lince.</p>
        )}
      </div>
      <button
        className="auth-refresh"
        onClick={refresh}
        disabled={auth.state === "checking"}
        aria-label="Verificar autenticação novamente"
        title="Verificar novamente"
      >
        ↻
      </button>
    </section>
  );
}
