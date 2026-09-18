const icons = import.meta.glob<string>("./assets/material/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});
function asset(name: string) {
  return (
    icons[`./assets/material/${name}.svg`] ??
    icons["./assets/material/file.svg"]
  );
}
const extensions: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "react",
  jsx: "react",
  sql: "database",
  yml: "yaml",
  yaml: "yaml",
  json: "json",
  jsonc: "json",
  py: "python",
  pyi: "python",
  rs: "rust",
  go: "go",
  java: "java",
  cs: "csharp",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  php: "php",
  phtml: "php",
  kt: "kotlin",
  swift: "swift",
  md: "markdown",
  html: "html",
  css: "css",
  scss: "css",
  sh: "console",
  bash: "console",
  zsh: "console",
  xml: "xml",
  svg: "image",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  toml: "toml",
  lock: "lock",
};
export function FileIcon({ path }: { path: string }) {
  const name = path.split("/").at(-1)!.toLowerCase();
  const ext = name.split(".").at(-1)!;
  const icon = /^dockerfile(?:\.|$)|^docker-compose\./.test(name)
    ? "docker"
    : name.startsWith(".git")
      ? "git"
      : /\.(test|spec)\.[cm]?[jt]sx?$/.test(name)
        ? ext.includes("ts")
          ? "test-ts"
          : "test-js"
        : (extensions[ext] ?? "file");
  return (
    <img
      className="material-file-icon"
      src={asset(icon)}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
const folders: Record<string, string> = {
  src: "src",
  tests: "test",
  test: "test",
  __tests__: "test",
  fixtures: "test",
  ".github": "github",
  workflows: "ci",
  helpers: "helper",
  utils: "utils",
  config: "config",
  setup: "config",
  images: "images",
  assets: "images",
  scripts: "scripts",
  components: "components",
  api: "api",
  database: "database",
  migrations: "database",
};
export function FolderIcon({
  name,
  open = false,
}: {
  name: string;
  open?: boolean;
}) {
  const kind = folders[name.toLowerCase()];
  return (
    <img
      className="material-file-icon"
      src={asset(`folder${kind ? `-${kind}` : ""}${open ? "-open" : ""}`)}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
export function Chevron({ open = false }: { open?: boolean }) {
  return (
    <svg
      className={`tree-chevron ${open ? "open" : ""}`}
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden="true"
    >
      <path
        d="m9 6 6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
