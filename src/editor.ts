import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import CssWorker from "monaco-editor/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker?worker";
import TypeScriptWorker from "monaco-editor/language/typescript/ts.worker?worker";
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
export const options: monaco.editor.IStandaloneEditorConstructionOptions = {
  theme: "lince",
  readOnly: true,
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
export class Project {
  readonly prefix: string;
  private owned = new Set<monaco.editor.ITextModel>();
  private disposables: monaco.IDisposable[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private configuration = "";
  private disposed = false;
  constructor(
    id: string,
    readonly index: RepoIndex,
  ) {
    this.prefix = `/lince/${encodeURIComponent(id)}/`;
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
  model(doc: Document) {
    const uri = this.uri(doc.path, doc.side);
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
    let i = 0;
    for (const doc of this.index.analysis) {
      if (this.disposed) return;
      if (doc.text !== null) this.model(doc);
      if (++i % 50 === 0)
        await new Promise((resolve) => setTimeout(resolve, 0));
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
  private compiler(model: monaco.editor.ITextModel) {
    const location = this.location(model.uri)!;
    const root = this.uri("", location.side).toString();
    let dir = location.path.split("/").slice(0, -1).join("/");
    let config: any;
    while (true) {
      for (const name of ["tsconfig.json", "jsconfig.json"]) {
        const path = (dir ? dir + "/" : "") + name;
        const doc = this.index.analysis.find(
          (d) => d.side === location.side && d.path === path,
        );
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
        const compiler = this.compiler(model);
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
        return work(worker);
      });
    this.queue = task;
    return task;
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
  async definitions(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
  ) {
    return this.locations(
      await this.query(model, (w) =>
        w.getDefinitionAtPosition(
          model.uri.toString(),
          model.getOffsetAt(position),
        ),
      ),
      model.uri,
    );
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
