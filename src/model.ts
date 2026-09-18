export interface ChangedFile {
  path: string;
  previousPath: string | null;
  status: string;
  additions: number;
  deletions: number;
  version: string;
}
export interface Snapshot {
  id: string;
  key: string;
  url: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  baseSha: string;
  headSha: string;
  mergeBase: string;
  files: ChangedFile[];
}
export interface FileDiff {
  patch: string | null;
  reason: string | null;
  reviewable: boolean;
}
export interface FileProgress {
  version: string;
  reviewed: boolean;
  approvedUnread?: boolean;
  top: number;
  left: number;
}
export interface ReviewProgress {
  selected: string;
  files: Record<string, FileProgress>;
}
export interface Store {
  schema: number;
  lastUrl: string;
  reviews: Record<string, ReviewProgress>;
}
export const emptyStore = (): Store => ({
  schema: 1,
  lastUrl: "",
  reviews: {},
});
export function reconcile(
  snapshot: Snapshot,
  previous?: ReviewProgress,
): { review: ReviewProgress; invalidated: number } {
  let invalidated = 0;
  const files = Object.fromEntries(
    snapshot.files.map((file) => {
      const old = previous?.files[file.path];
      if (isResolved(old) && old?.version !== file.version) invalidated++;
      return [
        file.path,
        old?.version === file.version
          ? old
          : { version: file.version, reviewed: false, top: 0, left: 0 },
      ];
    }),
  );
  return {
    review: {
      selected: snapshot.files.some((f) => f.path === previous?.selected)
        ? previous!.selected
        : (snapshot.files[0]?.path ?? ""),
      files,
    },
    invalidated,
  };
}
export const statusLabels: Record<string, string> = {
  added: "Adicionado",
  removed: "Removido",
  modified: "Modificado",
  renamed: "Renomeado",
  changed: "Modo alterado",
};

export type ReviewDecision = "pending" | "viewed" | "approvedUnread";
export function isResolved(file?: FileProgress): boolean {
  return !!(file?.reviewed || file?.approvedUnread);
}
export interface ReviewSummary {
  total: number;
  viewed: number;
  approvedUnread: number;
}
export function folderSummaries(
  files: Record<string, FileProgress>,
): Map<string, ReviewSummary> {
  const folders = new Map<string, ReviewSummary>();
  for (const [path, state] of Object.entries(files)) {
    let prefix = "";
    for (const part of path.split("/").slice(0, -1)) {
      prefix += part + "/";
      const summary = folders.get(prefix) ?? {
        total: 0,
        viewed: 0,
        approvedUnread: 0,
      };
      summary.total++;
      if (state.reviewed) summary.viewed++;
      else if (state.approvedUnread) summary.approvedUnread++;
      folders.set(prefix, summary);
    }
  }
  return folders;
}
