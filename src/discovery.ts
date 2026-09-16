export interface Repository {
  name: string;
  owner: string;
  private: boolean;
  language: string | null;
  topics: string[];
}
export interface RepoActivity {
  repo: string;
  sessions: number;
  lastReviewedAt: number;
  score: number;
}
export interface Codebase {
  path: string;
  label: string;
}
export interface RepoConfig {
  repo: string;
  monorepo: boolean;
  codebases: Codebase[];
}
export interface PullRequest {
  number: number;
  title: string;
  url: string;
  author: string;
  draft: boolean;
  createdAt: string;
  head: string;
  base: string;
  headSha: string;
  baseSha: string;
}
export interface Page<T> {
  warning?: string | null;
  items: T[];
  hasMore: boolean;
}
export interface ServiceLabels {
  labels: string[];
  outside: boolean;
}
export function ranked(repos: Repository[], history: RepoActivity[]) {
  const stats = new Map(history.map((h) => [h.repo.toLowerCase(), h]));
  return [...repos].sort((a, b) => {
    const x = stats.get(a.name.toLowerCase()),
      y = stats.get(b.name.toLowerCase());
    return (
      (y?.score ?? 0) - (x?.score ?? 0) ||
      (y?.lastReviewedAt ?? 0) - (x?.lastReviewedAt ?? 0) ||
      a.name.localeCompare(b.name)
    );
  });
}
// Limit discovery work before IPC; abandoned screens don't leave a large backend queue.
let running = 0;
const waiting: (() => void)[] = [];
export function schedule<T>(
  work: () => Promise<T>,
  current: () => boolean,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      if (!current()) {
        reject(new Error("Consulta cancelada"));
        next();
        return;
      }
      running++;
      void work()
        .then(resolve, reject)
        .finally(() => {
          running--;
          next();
        });
    };
    const next = () => {
      if (running < 3) waiting.shift()?.();
    };
    waiting.push(run);
    next();
  });
}
export function parseCodebases(text: string): Codebase[] {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const separator = line.indexOf("=");
      if (separator < 1 || !line.slice(separator + 1).trim())
        throw new Error(
          "Use caminho = Nome do serviço, uma linha por serviço.",
        );
      return {
        path: line.slice(0, separator).trim().replace(/\/$/, ""),
        label: line.slice(separator + 1).trim(),
      };
    });
}
