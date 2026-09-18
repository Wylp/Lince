import { ReviewBadge, contextKey } from "./ReviewState";
import type { ReviewContextHandler } from "./ReviewState";
import type { ReviewProgress, ReviewSummary } from "./model";
import { FileIcon, FolderIcon, Chevron } from "./FileIcon";
import { useEffect, useMemo, useState } from "react";
interface Node {
  dirs: Map<string, Node>;
  files: string[];
}
export function RepositoryTree({
  paths,
  selected,
  open,
  changed,
  context,
  progress,
  folders,
}: {
  paths: string[];
  selected: string;
  open: (path: string) => void;
  changed: Set<string>;
  context: ReviewContextHandler;
  progress: ReviewProgress;
  folders: Map<string, ReviewSummary>;
}) {
  const tree = useMemo(() => {
    const root: Node = { dirs: new Map(), files: [] };
    for (const path of paths) {
      let n = root;
      for (const part of path.split("/").slice(0, -1)) {
        if (!n.dirs.has(part)) n.dirs.set(part, { dirs: new Map(), files: [] });
        n = n.dirs.get(part)!;
      }
      n.files.push(path);
    }
    return root;
  }, [paths]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    setExpanded((old) => {
      const next = new Set(old);
      let path = "";
      for (const part of selected.split("/").slice(0, -1)) {
        path += part + "/";
        next.add(path);
      }
      return next;
    });
  }, [selected]);
  function branch(node: Node, prefix = ""): React.ReactNode {
    return (
      <ul>
        {[...node.dirs].map(([name, child]) => {
          const path = prefix + name + "/";
          return (
            <li key={path}>
              <button
                className="directory-item"
                aria-expanded={expanded.has(path)}
                onKeyDown={(e) => contextKey(e, path, true, context)}
                onContextMenu={(e) => context(e, path, true)}
                onClick={() =>
                  setExpanded((old) => {
                    const next = new Set(old);
                    next.has(path) ? next.delete(path) : next.add(path);
                    return next;
                  })
                }
              >
                <Chevron open={expanded.has(path)} />
                <FolderIcon name={name} open={expanded.has(path)} />
                <span className="filename">{name}</span>
                <ReviewBadge summary={folders.get(path)} />
              </button>
              {expanded.has(path) && branch(child, path)}
            </li>
          );
        })}
        {node.files.map((path) => (
          <li key={path}>
            <button
              className={`file-item ${selected === path ? "selected" : ""}`}
              title={path}
              onClick={() => open(path)}
              onKeyDown={(e) => contextKey(e, path, false, context)}
              onContextMenu={(e) => context(e, path, false)}
            >
              <FileIcon path={path} />
              <span className="filename">{path.split("/").at(-1)}</span>
              <ReviewBadge file={progress.files[path]} />
              {changed.has(path) && <span className="green">M</span>}
            </button>
          </li>
        ))}
      </ul>
    );
  }
  return <nav aria-label="Arquivos do repositório">{branch(tree)}</nav>;
}
