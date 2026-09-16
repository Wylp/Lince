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
}: {
  files: ChangedFile[];
  progress: ReviewProgress;
  select: (path: string) => void;
}) {
  function branch(node: Node, prefix = ""): React.ReactNode {
    return (
      <ul>
        {[...node.dirs].map(([dir, child]) => (
          <li key={dir}>
            <details open>
              <summary title={prefix + dir}>
                <span className="folder-icon">▱</span> {dir}
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
              title={`${file.path} · ${statusLabels[file.status] ?? file.status}${progress.files[file.path]?.reviewed ? " · Revisado" : ""}`}
            >
              <span
                className={`file-state ${progress.files[file.path]?.reviewed ? "done" : ""}`}
                aria-label={
                  progress.files[file.path]?.reviewed ? "Revisado" : "Pendente"
                }
              >
                {progress.files[file.path]?.reviewed ? "✓" : "○"}
              </span>
              <span className="filename">{file.path.split("/").at(-1)}</span>
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
