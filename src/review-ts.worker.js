// Extend the bundled Monaco worker, reusing its TypeScript parser and resolver.
import {
  initialize,
  TypeScriptWorker,
  ts,
} from "monaco-editor/language/typescript/ts.worker";
class ReviewWorker extends TypeScriptWorker {
  setScope(files) {
    this.scope = new Set(files);
  }
  getScriptFileNames() {
    return super
      .getScriptFileNames()
      .filter((name) => !this.scope || this.scope.has(name));
  }
  discoverDependencies(sources, repositoryFiles) {
    const available = new Set(repositoryFiles);
    const api = ts.typescript;
    const host = {
      fileExists: (name) => available.has(name),
      readFile: (name) => this._getScriptText(name),
      directoryExists: () => true,
      getCurrentDirectory: () => "",
      realpath: (name) => name,
    };
    const found = new Set();
    for (const source of sources) {
      const content = this._getScriptText(source);
      if (content === undefined) continue;
      const info = api.preProcessFile(content, true, true);
      for (const item of info.importedFiles) {
        const resolved = api.resolveModuleName(
          item.fileName,
          source,
          this.getCompilationSettings(),
          host,
        ).resolvedModule;
        if (resolved && available.has(resolved.resolvedFileName))
          found.add(resolved.resolvedFileName);
      }
      for (const ref of info.referencedFiles) {
        const target = new URL(ref.fileName, source).href;
        if (available.has(target)) found.add(target);
      }
    }
    return [...found];
  }
}
self.onmessage = () => initialize((ctx, data) => new ReviewWorker(ctx, data));
