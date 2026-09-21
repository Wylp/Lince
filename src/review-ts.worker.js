// Extend the bundled Monaco worker, reusing its TypeScript parser and resolver.
import {
  initialize,
  TypeScriptWorker,
  ts,
} from "monaco-editor/language/typescript/ts.worker";
class ReviewWorker extends TypeScriptWorker {
  reviewReferences(fileName, position) {
    return (
      this._languageService.findReferences(fileName, position) ?? []
    ).flatMap((group) => group.references.filter((ref) => !ref.isDefinition));
  }
  reviewTypes(fileName) {
    const api = ts.typescript;
    const program = this._languageService.getProgram();
    const source = program?.getSourceFile(fileName);
    if (!source) return [];
    const checker = program.getTypeChecker();
    const alerts = [];
    const visit = (node) => {
      if (alerts.length >= 200) return;
      if (
        (api.isVariableDeclaration(node) ||
          api.isParameter(node) ||
          api.isPropertyDeclaration(node)) &&
        api.isIdentifier(node.name)
      ) {
        const type = checker.getTypeAtLocation(node.name);
        if (type.isUnion()) {
          const kinds = new Set(
            type.types.map((t) =>
              t.flags & api.TypeFlags.StringLike
                ? "string"
                : t.flags & api.TypeFlags.NumberLike
                  ? "number"
                  : t.flags & api.TypeFlags.BooleanLike
                    ? "boolean"
                    : t.flags & api.TypeFlags.Null
                      ? "null"
                      : t.flags & api.TypeFlags.Undefined
                        ? "undefined"
                        : t.flags & api.TypeFlags.Object
                          ? "object"
                          : "other",
            ),
          );
          if (kinds.size > 1) {
            const position = source.getLineAndCharacterOfPosition(
              node.name.getStart(source),
            );
            alerts.push({
              name: node.name.text,
              type: checker.typeToString(type),
              line: position.line + 1,
              column: position.character + 1,
            });
          }
        }
      }
      api.forEachChild(node, visit);
    };
    visit(source);
    return alerts;
  }
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
