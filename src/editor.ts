import * as monaco from "monaco-editor";
import { invoke } from "@tauri-apps/api/core";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import CssWorker from "monaco-editor/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker?worker";
import TypeScriptWorker from "./review-ts.worker.js?worker";
import { parse } from "jsonc-parser";
export { monaco };
(
  self as unknown as { MonacoEnvironment: monaco.Environment }
).MonacoEnvironment = {
  getWorker: (_id, label) =>
    label === "typescript" || label === "javascript"
      ? new TypeScriptWorker()
      : label === "json"
        ? new JsonWorker()
        : ["css", "scss", "less"].includes(label)
          ? new CssWorker()
          : ["html", "handlebars", "razor"].includes(label)
            ? new HtmlWorker()
            : new EditorWorker(),
};
monaco.editor.defineTheme("lince", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "769385" },
    { token: "keyword", foreground: "bba7ed" },
    { token: "string", foreground: "b6d995" },
    { token: "number", foreground: "e7c18a" },
    { token: "type.identifier", foreground: "83d7c4" },
  ],
  colors: {
    "editor.background": "#101713",
    "editor.foreground": "#d6e4db",
    "editorLineNumber.foreground": "#506a5c",
    "editorLineNumber.activeForeground": "#b7ddc4",
    "editor.selectionBackground": "#315940",
    "editor.lineHighlightBackground": "#19271f",
    "editorCursor.foreground": "#a4edbf",
    "diffEditor.insertedTextBackground": "#2b784b35",
    "diffEditor.removedTextBackground": "#c2595e30",
    "diffEditor.insertedLineBackground": "#18412b45",
    "diffEditor.removedLineBackground": "#522a3035",
    "diffEditorOverview.insertedForeground": "#75d99b",
    "diffEditorOverview.removedForeground": "#ef858b",
    "peekViewEditor.background": "#142019",
    "peekView.border": "#71c78e",
  },
});
const ts = monaco.typescript;
monaco.json.jsonDefaults.setDiagnosticsOptions({
  validate: false,
  enableSchemaRequest: false,
});
monaco.css.cssDefaults.setOptions({ validate: false });

for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
  defaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
  });
  defaults.setEagerModelSync(true);
  defaults.setModeConfiguration({
    completionItems: false,
    hovers: false,
    documentSymbols: true,
    definitions: false,
    references: false,
    documentHighlights: true,
    rename: false,
    diagnostics: false,
    documentRangeFormattingEdits: false,
    signatureHelp: false,
    inlayHints: false,
    codeActions: false,
  });
}
export type Side = "head" | "base";
export interface RepoEntry {
  path: string;
  oid: string;
  mode: string;
  size: number;
}
export interface Document {
  path: string;
  side: Side;
  text: string | null;
  reason: string | null;
}
export interface RepoIndex {
  head: RepoEntry[];
  base: RepoEntry[];
  analysis: Document[];
  warnings: string[];
}
export interface Location {
  path: string;
  side: Side;
  line?: number;
  column?: number;
}
export function language(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  return (
    (
      {
        ts: "typescript",
        tsx: "typescript",
        mts: "typescript",
        cts: "typescript",
        js: "javascript",
        jsx: "javascript",
        mjs: "javascript",
        cjs: "javascript",
        json: "json",
        rs: "rust",
        py: "python",
        pyi: "python",
        cc: "cpp",
        cxx: "cpp",
        hpp: "cpp",
        hh: "cpp",
        hxx: "cpp",
        phtml: "php",
        go: "go",
        java: "java",
        kt: "kotlin",
        cs: "csharp",
        cpp: "cpp",
        c: "c",
        h: "cpp",
        rb: "ruby",
        php: "php",
        swift: "swift",
        css: "css",
        scss: "scss",
        html: "html",
        vue: "html",
        svelte: "html",
        md: "markdown",
        yaml: "yaml",
        yml: "yaml",
        toml: "ini",
        sh: "shell",
        sql: "sql",
        xml: "xml",
        dockerfile: "dockerfile",
      } as Record<string, string>
    )[ext ?? ""] ?? "plaintext"
  );
}
export const syntaxLanguages = [
  "python",
  "java",
  "csharp",
  "go",
  "rust",
  "c",
  "cpp",
  "php",
];
export const semanticLanguage = (id: string) =>
  ["typescript", "javascript"].includes(id);
// Only controls the link decoration; the language service still resolves the target.
export function referenceRange(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
) {
  const line = model.getLineContent(position.lineNumber);
  for (const match of line.matchAll(/(['"])([^'"\r\n]+)\1/g)) {
    const start = match.index! + 2,
      end = start + match[2].length;
    if (position.column >= start && position.column <= end)
      return new monaco.Range(
        position.lineNumber,
        start,
        position.lineNumber,
        end,
      );
  }
  const word = model.getWordAtPosition(position);
  return word
    ? new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      )
    : undefined;
}
export const options: monaco.editor.IStandaloneEditorConstructionOptions = {
  theme: "lince",
  readOnly: true,
  renderValidationDecorations: "on",
  domReadOnly: true,
  automaticLayout: true,
  fontSize: 13,
  lineHeight: 22,
  fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  smoothScrolling: false,
  padding: { top: 12, bottom: 12 },
  renderWhitespace: "selection",
  wordWrap: "off",
  links: false,
  contextmenu: true,
  tabSize: 2,
  stickyScroll: { enabled: true },
  unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false },
  bracketPairColorization: { enabled: true },
  overviewRulerBorder: false,
};
export interface TypeAlert {
  name: string;
  type: string;
  line: number;
  column: number;
}
interface ReviewWorker {
  reviewReferences(fileName: string, position: number): Promise<any[]>;
  reviewTypes(fileName: string): Promise<TypeAlert[]>;
  discoverDependencies(
    sources: string[],
    repositoryFiles: string[],
  ): Promise<string[]>;
  setScope(files: string[]): Promise<void>;
}
export class Project {
  readonly prefix: string;
  private owned = new Set<monaco.editor.ITextModel>();
  private recentViews = new Set<string>();
  private disposables: monaco.IDisposable[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private configuration = "";
  private disposed = false;
  private configs = new Map<string, Document>();
  private graphs = new Map<string, Set<string>>();
  private fileSets: Record<Side, Set<string>>;

  constructor(
    private readonly id: string,
    readonly index: RepoIndex,
    private readonly notice: (message: string) => void = () => {},
  ) {
    this.prefix = `/lince/${encodeURIComponent(id)}/`;
    this.fileSets = {
      head: new Set(index.head.map((e) => e.path)),
      base: new Set(index.base.map((e) => e.path)),
    };
  }
  uri(path: string, side: Side) {
    return monaco.Uri.from({
      scheme: "file",
      path: `${this.prefix}${side}/${path}`,
    });
  }
  location(uri: monaco.Uri): Location | null {
    if (!uri.path.startsWith(this.prefix)) return null;
    const relative = uri.path.slice(this.prefix.length);
    const slash = relative.indexOf("/");
    const side = relative.slice(0, slash);
    return side === "base" || side === "head"
      ? { path: relative.slice(slash + 1), side }
      : null;
  }
  model(doc: Document, dependency = false) {
    const uri = this.uri(doc.path, doc.side);
    if (!dependency) {
      // Protect views prepared by React before Monaco has attached them.
      this.recentViews.delete(uri.toString());
      this.recentViews.add(uri.toString());
      if (this.recentViews.size > 12)
        this.recentViews.delete(this.recentViews.values().next().value!);
    }
    let model = monaco.editor.getModel(uri);
    if (!model) {
      model = monaco.editor.createModel(
        doc.text ?? "",
        language(doc.path),
        uri,
      );
      this.owned.add(model);
    }
    return model;
  }
  async initialize() {
    for (const lang of syntaxLanguages) {
      this.disposables.push(
        monaco.languages.registerDefinitionProvider(lang, {
          provideDefinition: (model, position) =>
            this.definitions(model, position),
        }),
      );
    }
    for (const lang of ["typescript", "javascript"]) {
      this.disposables.push(
        monaco.languages.registerDefinitionProvider(lang, {
          provideDefinition: (model, position) =>
            this.definitions(model, position),
        }),
      );
      this.disposables.push(
        monaco.languages.registerReferenceProvider(lang, {
          provideReferences: (model, position) =>
            this.references(model, position),
        }),
      );
      this.disposables.push(
        monaco.languages.registerHoverProvider(lang, {
          provideHover: async (model, position) => {
            const info = await this.query(model, async (worker) =>
              worker.getQuickInfoAtPosition(
                model.uri.toString(),
                model.getOffsetAt(position),
              ),
            );
            if (!info) return null;
            return {
              contents: [
                {
                  value:
                    "```typescript\n" +
                    info.displayParts
                      .map((p: { text: string }) => p.text)
                      .join("") +
                    "\n```",
                },
                {
                  value: (info.documentation ?? [])
                    .map((p: { text: string }) => p.text)
                    .join(""),
                },
              ],
            };
          },
        }),
      );
    }
  }
  private async compiler(model: monaco.editor.ITextModel) {
    const location = this.location(model.uri)!;
    const root = this.uri("", location.side).toString();
    let dir = location.path.split("/").slice(0, -1).join("/");
    let config: any;
    while (true) {
      for (const name of ["tsconfig.json", "jsconfig.json"]) {
        const path = (dir ? dir + "/" : "") + name;
        const cacheKey = `${location.side}:${path}`;
        if (
          this.fileSets[location.side].has(path) &&
          !this.configs.has(cacheKey)
        ) {
          const docs = await invoke<Document[]>("read_repository_files", {
            snapshotId: this.id,
            side: location.side,
            paths: [path],
          });
          this.configs.set(cacheKey, docs[0]);
        }
        const doc = this.configs.get(cacheKey);
        if (doc?.text) {
          config = { ...parse(doc.text)?.compilerOptions, dir };
          break;
        }
      }
      if (config || !dir) break;
      dir = dir.split("/").slice(0, -1).join("/");
    }
    return {
      allowJs: true,
      allowNonTsExtensions: true,
      checkJs: false,
      strictNullChecks: true,
      allowImportingTsExtensions: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      jsx: ts.JsxEmit.ReactJSX,
      resolveJsonModule: true,
      baseUrl:
        root + (config?.dir ? config.dir + "/" : "") + (config?.baseUrl ?? "."),
      paths: config?.paths ?? {},
    };
  }
  private query<T>(
    model: monaco.editor.ITextModel,
    work: (
      worker: Awaited<
        ReturnType<Awaited<ReturnType<typeof ts.getTypeScriptWorker>>>
      >,
    ) => Promise<T>,
  ): Promise<T | undefined> {
    if (
      this.disposed ||
      !this.location(model.uri) ||
      !["typescript", "javascript"].includes(model.getLanguageId())
    )
      return Promise.resolve(undefined);
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        if (this.disposed || model.isDisposed()) return undefined;
        const compiler = await this.compiler(model);
        if (this.disposed || model.isDisposed()) return undefined;
        const key = JSON.stringify(compiler);
        if (key !== this.configuration) {
          ts.typescriptDefaults.setCompilerOptions(compiler);
          ts.javascriptDefaults.setCompilerOptions(compiler);
          this.configuration = key;
        }
        const getWorker = await (model.getLanguageId() === "javascript"
          ? ts.getJavaScriptWorker()
          : ts.getTypeScriptWorker());
        const worker = await getWorker(model.uri);
        await this.prepareDependencies(
          model,
          worker as unknown as ReviewWorker,
          getWorker,
        );
        if (this.disposed || model.isDisposed()) return undefined;
        return work(worker);
      });
    this.queue = task;
    return task;
  }
  private async prepareDependencies(
    model: monaco.editor.ITextModel,
    worker: ReviewWorker,
    sync: (...uris: monaco.Uri[]) => Promise<unknown>,
  ) {
    const origin = this.location(model.uri)!;
    const graphKey = model.uri.toString();
    let graph = this.graphs.get(graphKey);
    const known = this.index[origin.side];
    const allUris = known.map((e) => this.uri(e.path, origin.side).toString());
    const sizes = new Map(
      known.map((e) => [this.uri(e.path, origin.side).toString(), e.size]),
    );
    const maxBytes = 32 * 1024 * 1024;
    const load = async (uris: string[]) => {
      const missing = uris.filter(
        (uri) => !monaco.editor.getModel(monaco.Uri.parse(uri)),
      );
      // Eight files per batch keeps the existing 1 MiB per-file bound under 8 MiB.
      for (let i = 0; i < missing.length; i += 8) {
        if (this.disposed) return;
        const paths = missing
          .slice(i, i + 8)
          .map((uri) => this.location(monaco.Uri.parse(uri))!.path);
        const docs = await invoke<Document[]>("read_repository_files", {
          snapshotId: this.id,
          side: origin.side,
          paths,
        });
        if (this.disposed) return;
        for (const doc of docs) {
          if (doc.text !== null) this.model(doc, true);
          else
            this.notice(
              `Dependência indisponível: ${doc.path}. ${doc.reason ?? ""}`,
            );
        }
      }
      if (!this.disposed)
        await sync(...uris.map((uri) => monaco.Uri.parse(uri)));
    };
    if (!graph) {
      graph = new Set([graphKey]);
      let frontier = [graphKey];
      let bytes = sizes.get(graphKey) ?? 0;
      let partial = false;
      const started = performance.now();
      while (frontier.length && !this.disposed) {
        if (performance.now() - started > 15000 || graph.size > 10000) {
          partial = true;
          break;
        }
        const dependencies = await worker.discoverDependencies(
          frontier,
          allUris,
        );
        frontier = [];
        for (const uri of dependencies) {
          if (graph.has(uri)) continue;
          const size = sizes.get(uri) ?? 0;
          if (size > 1024 * 1024 || bytes + size > maxBytes) {
            partial = true;
            continue;
          }
          bytes += size;
          graph.add(uri);
          frontier.push(uri);
        }
        await load(frontier);
      }
      if (partial && !this.disposed)
        this.notice(
          "Análise das dependências deste arquivo ficou parcial por limite de memória, tempo ou tamanho. Navegue diretamente para carregar outros trechos.",
        );
      // Partial graphs can be retried after navigating; never claim a complete index.
      if (!partial) {
        if (this.graphs.size >= 12) this.graphs.clear();
        this.graphs.set(graphKey, graph);
      }
    } else await load([...graph]);
    if (this.disposed) return;
    await worker.setScope([...graph]);
    // Only the current graph participates in semantics. Evict idle project/side models;
    // visible diff/preview models stay intact, so reading positions never jump.
    for (const candidate of this.owned) {
      if (
        !graph.has(candidate.uri.toString()) &&
        !this.recentViews.has(candidate.uri.toString()) &&
        !candidate.isAttachedToEditor()
      ) {
        candidate.dispose();
        this.owned.delete(candidate);
      }
    }
  }
  private locations(items: readonly any[] | undefined, source: monaco.Uri) {
    return (items ?? []).flatMap((item) => {
      const uri = monaco.Uri.parse(item.fileName);
      const model = monaco.editor.getModel(uri);
      if (
        !model ||
        !this.location(uri) ||
        this.location(uri)?.side !== this.location(source)?.side
      )
        return [];
      const start = model.getPositionAt(item.textSpan.start),
        end = model.getPositionAt(item.textSpan.start + item.textSpan.length);
      return [
        {
          uri,
          range: new monaco.Range(
            start.lineNumber,
            start.column,
            end.lineNumber,
            end.column,
          ),
        },
      ];
    });
  }
  private async syntaxDefinitions(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
  ): Promise<monaco.languages.LocationLink[]> {
    const origin = this.location(model.uri);
    if (!origin || this.disposed) return [];
    this.notice("Buscando declarações no snapshot local…");
    try {
      const result = await invoke<{
        targets: {
          path: string;
          line: number;
          column: number;
          endLine: number;
          endColumn: number;
        }[];
        warnings: string[];
        indexedFiles: number;
      }>("get_code_definitions", {
        snapshotId: this.id,
        side: origin.side,
        path: origin.path,
        line: position.lineNumber,
        column: position.column,
      });
      if (this.disposed || model.isDisposed()) return [];
      const matches: monaco.languages.LocationLink[] = [];
      for (const target of result.targets) {
        if (this.disposed) return [];
        const uri = this.uri(target.path, origin.side);
        if (!monaco.editor.getModel(uri)) {
          const doc = await invoke<Document>("read_repository_file", {
            snapshotId: this.id,
            side: origin.side,
            path: target.path,
          });
          if (this.disposed) return [];
          if (doc.text === null) continue;
          this.model(doc);
        }
        matches.push({
          uri,
          range: new monaco.Range(
            target.line,
            target.column,
            target.endLine,
            target.endColumn,
          ),
          originSelectionRange: referenceRange(model, position),
        });
      }
      this.notice(
        [
          matches.length
            ? "Declarações candidatas por sintaxe; tipos, aliases e sobrecargas não são resolvidos."
            : "Nenhuma declaração encontrada no índice sintático local.",
          ...result.warnings,
        ].join(" "),
      );
      return matches;
    } catch (e) {
      if (!this.disposed)
        this.notice(`Não foi possível localizar a definição: ${String(e)}`);
      return [];
    }
  }
  async definitions(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
  ) {
    if (syntaxLanguages.includes(model.getLanguageId()))
      return this.syntaxDefinitions(model, position);
    return this.locations(
      await this.query(model, (w) =>
        w.getDefinitionAtPosition(
          model.uri.toString(),
          model.getOffsetAt(position),
        ),
      ),
      model.uri,
    ).map((location): monaco.languages.LocationLink => ({
      ...location,
      originSelectionRange: referenceRange(model, position),
    }));
  }
  async typeAlerts(model: monaco.editor.ITextModel) {
    return (
      (await this.query(model, (w) =>
        (w as unknown as ReviewWorker).reviewTypes(model.uri.toString()),
      )) ?? []
    );
  }
  async reviewUsages(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    progress: (text: string) => void,
    cancelled: () => boolean = () => false,
  ) {
    return this.query(model, async (w) => {
      const origin = this.location(model.uri)!;
      const candidates = this.index[origin.side].filter((f) =>
        /\.[cm]?[jt]sx?$/.test(f.path),
      );
      const scope = new Set<string>(
        this.graphs.get(model.uri.toString()) ?? [model.uri.toString()],
      );
      const started = performance.now();
      // Search only on request, from the immutable local snapshot. Bound memory.
      let bytes = 0,
        scanned = 0;
      const selected = [];
      for (const file of candidates) {
        if (
          file.size > 1024 * 1024 ||
          bytes + file.size > 32 * 1024 * 1024 ||
          selected.length >= 5000
        )
          continue;
        bytes += file.size;
        selected.push(file);
      }
      for (let i = 0; i < selected.length; i += 8) {
        if (performance.now() - started > 20000) break;
        if (this.disposed || cancelled()) throw new Error("Busca encerrada");
        progress(`Buscando usos: ${i} de ${selected.length} arquivos JS/TS…`);
        const docs = await invoke<Document[]>("read_repository_files", {
          snapshotId: this.id,
          side: origin.side,
          paths: selected.slice(i, i + 8).map((f) => f.path),
        });
        if (this.disposed || cancelled()) throw new Error("Busca encerrada");
        for (const doc of docs)
          if (doc.text !== null) {
            scope.add(this.model(doc, true).uri.toString());
            scanned++;
          }
      }
      const getWorker = await (model.getLanguageId() === "javascript"
        ? ts.getJavaScriptWorker()
        : ts.getTypeScriptWorker());
      await getWorker(...[...scope].map((uri) => monaco.Uri.parse(uri)));
      await (w as unknown as ReviewWorker).setScope([...scope]);
      const refs = await (w as unknown as ReviewWorker).reviewReferences(
        model.uri.toString(),
        model.getOffsetAt(position),
      );
      const entries = this.locations(refs, model.uri);
      return { entries, scanned, total: candidates.length };
    });
  }
  async references(model: monaco.editor.ITextModel, position: monaco.Position) {
    return this.locations(
      await this.query(model, (w) =>
        w.getReferencesAtPosition(
          model.uri.toString(),
          model.getOffsetAt(position),
        ),
      ),
      model.uri,
    );
  }
  dispose() {
    this.disposed = true;
    this.disposables.forEach((d) => d.dispose());
    this.owned.forEach((m) => m.dispose());
  }
}
