import { ReviewBadge, contextKey } from "./ReviewState";
import type { ReviewContextHandler } from "./ReviewState";
import type { ReviewSummary } from "./model";
import { FileIcon, FolderIcon, Chevron } from "./FileIcon";
import type { ChangedFile, ReviewProgress } from "./model";
import { statusLabels } from "./model";
interface Node {
  dirs: Map<string, Node>;
  files: ChangedFile[];
}
function tree(files: ChangedFile[]): Node {
  const root: Node = { dirs: new Map(), files: [] };
  for (const file of files) {
    let node = root;
    for (const dir of file.path.split("/").slice(0, -1)) {
      if (!node.dirs.has(dir))
        node.dirs.set(dir, { dirs: new Map(), files: [] });
      node = node.dirs.get(dir)!;
    }
    node.files.push(file);
  }
  return root;
}
export function FileTree({
  files,
  progress,
  select,
  context,
  folders,
}: {
  files: ChangedFile[];
  progress: ReviewProgress;
  select: (path: string) => void;
  context: ReviewContextHandler;
  folders: Map<string, ReviewSummary>;
}) {
  function branch(node: Node, prefix = ""): React.ReactNode {
    return (
      <ul>
        {[...node.dirs].map(([dir, child]) => (
          <li key={dir}>
            <details open>
              <summary
                onKeyDown={(e) =>
                  contextKey(e, prefix + dir + "/", true, context)
                }
                title={prefix + dir}
                onContextMenu={(e) => context(e, prefix + dir + "/", true)}
              >
                <Chevron />
                <span className="folder-closed">
                  <FolderIcon name={dir} />
                </span>
                <span className="folder-open">
                  <FolderIcon name={dir} open />
                </span>
                <span className="filename">{dir}</span>
                <ReviewBadge summary={folders.get(prefix + dir + "/")} />
              </summary>
              {branch(child, prefix + dir + "/")}
            </details>
          </li>
        ))}
        {node.files.map((file) => (
          <li key={file.path}>
            <button
              className={`file-item ${progress.selected === file.path ? "selected" : ""}`}
              aria-current={
                progress.selected === file.path ? "true" : undefined
              }
              onClick={() => select(file.path)}
              onKeyDown={(e) => contextKey(e, file.path, false, context)}
              onContextMenu={(e) => context(e, file.path, false)}
              title={`${file.path} · ${statusLabels[file.status] ?? file.status}${progress.files[file.path]?.reviewed ? " · Revisado" : progress.files[file.path]?.approvedUnread ? " · Aprovado sem ler" : ""}`}
            >
              <FileIcon path={file.path} />
              <span className="filename">{file.path.split("/").at(-1)}</span>
              <ReviewBadge file={progress.files[file.path]} />
              <span
                className={`status-letter ${file.status}`}
                aria-label={statusLabels[file.status] ?? file.status}
              >
                {{
                  added: "A",
                  removed: "D",
                  renamed: "R",
                  modified: "M",
                  changed: "M",
                }[file.status] ?? "?"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }
  return <nav aria-label="Arquivos alterados">{branch(tree(files))}</nav>;
}
