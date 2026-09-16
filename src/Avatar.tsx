import { useState } from "react";
export function Avatar({ login, size = 28 }: { login: string; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      className="avatar"
      style={{ width: size, height: size }}
      title={login}
    >
      {failed !== login ? (
        <img
          src={`https://github.com/${encodeURIComponent(login)}.png?size=${size * 2}`}
          alt={`Avatar de ${login}`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(login)}
        />
      ) : (
        <span aria-label={login}>{login.slice(0, 2).toUpperCase()}</span>
      )}
    </span>
  );
}
