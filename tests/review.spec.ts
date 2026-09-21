import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as any;
    win.isTauri = true;
    Object.defineProperty(window.Notification, "permission", {
      configurable: true,
      get: () => "default",
    });
    window.Notification.requestPermission = async () =>
      win.denyNotifications ? "denied" : "granted";
    const files = [
      {
        path: "src/controller.ts",
        status: "modified",
        additions: 200,
        deletions: 200,
        version: "v1",
        previousPath: null,
      },
      {
        path: "src/service.ts",
        status: "added",
        additions: 200,
        deletions: 0,
        version: "v1",
        previousPath: null,
      },
      {
        path: "assets/image.png",
        status: "added",
        additions: 0,
        deletions: 0,
        version: "v1",
        previousPath: null,
      },
      ...Array.from({ length: 150 }, (_, i) => ({
        path: `tests/case-${i}.ts`,
        status: "modified",
        additions: 1,
        deletions: 1,
        version: "v1",
        previousPath: null,
      })),
    ];
    const snapshot = {
      id: "demo:base:head",
      key: "acme/project#42",
      url: "https://github.com/acme/project/pull/42",
      repo: "acme/project",
      number: 42,
      title: "Preserve context while reviewing pull requests",
      author: "developer",
      baseBranch: "main",
      headBranch: "feat/review",
      baseSha: "abc1234",
      headSha: "def5678",
      mergeBase: "abc1234",
      files,
    };
    win.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      transformCallback: () => 1,
      invoke: async (command: string, args: any) => {
        if (command === "updates_enabled") return win.testUpdates ?? false;
        if (command === "plugin:updater|check")
          return { rid: 99, currentVersion: "0.1.0", version: "0.2.0" };
        if (command === "plugin:updater|download") {
          if (win.updateFail) throw "Falha no download";
          return 100;
        }
        if (command === "plugin:updater|install") {
          win.updateInstalled = true;
          return;
        }
        if (command === "plugin:process|restart") {
          win.restarted = true;
          return;
        }
        if (command === "list_watches")
          return JSON.parse(localStorage.getItem("test-watches") || "[]");
        if (command === "set_watch") {
          const rows = JSON.parse(
            localStorage.getItem("test-watches") || "[]",
          ).filter((w: any) => w.repo !== args.repo);
          if (args.enabled) rows.push({ account: "reviewer", repo: args.repo });
          localStorage.setItem("test-watches", JSON.stringify(rows));
          return;
        }
        if (command === "plugin:notification|is_permission_granted")
          return !win.denyNotifications;
        if (command === "plugin:notification|request_permission")
          return win.denyNotifications ? "denied" : "granted";
        if (command === "poll_watches")
          return {
            checked: 1,
            notified: 0,
            errors: win.pollError ? ["GitHub indisponível"] : [],
          };
        if (command === "get_review_history") {
          if (win.historyError) throw "Histórico indisponível";
          const saved = JSON.parse(
            localStorage.getItem("test-progress") || '{"reviews":{}}',
          );
          return Object.entries(saved.reviews).map(
            ([key, review]: [string, any]) => ({
              key,
              total: Object.keys(review.files).length,
              reviewed: Object.values(review.files).filter(
                (f: any) => f.reviewed,
              ).length,
              lastReviewedAt: null,
            }),
          );
        }
        if (command === "get_repo_activity")
          return [
            {
              repo: "zed/mono",
              score: 4,
              sessions: 5,
              lastReviewedAt: 1789500000,
            },
          ];
        if (command === "get_repo_configs")
          return JSON.parse(
            localStorage.getItem("test-configs") ||
              '[{"repo":"zed/mono","monorepo":true,"codebases":[{"path":"apps/api","label":"API"},{"path":"apps/web","label":"Web"}]}]',
          );
        if (command === "save_repo_config") {
          localStorage.setItem("test-configs", JSON.stringify([args.config]));
          return;
        }
        if (command === "list_repositories") {
          if (win.catalogError) throw "Falha ao buscar repositórios";
          return args.page === 1
            ? {
                items: [
                  {
                    name: "acme/project",
                    owner: "acme",
                    private: true,
                    language: "Rust",
                    topics: [],
                  },
                  {
                    name: "zed/mono",
                    owner: "zed",
                    private: true,
                    language: "TypeScript",
                    topics: [],
                  },
                ],
                hasMore: true,
              }
            : {
                items: [
                  {
                    name: "team/mobile",
                    owner: "team",
                    private: false,
                    language: "Swift",
                    topics: [],
                  },
                ],
                hasMore: false,
              };
        }
        if (command === "list_pull_requests") {
          if (args.repo === "team/mobile") return { items: [], hasMore: false };
          const numbers =
            args.repo === "zed/mono"
              ? args.page === 1
                ? [101, 102]
                : [103]
              : [42];
          return {
            items: numbers
              .filter(
                (number) =>
                  !args.author ||
                  args.author === (number === 102 ? "designer" : "reviewer"),
              )
              .map((number) => ({
                number,
                title:
                  number === 101
                    ? "Improve API request validation"
                    : number === 102
                      ? "Refresh Web dashboard"
                      : number === 103
                        ? "Share auth across services"
                        : "Preserve review context",
                url: `https://github.com/${args.repo}/pull/${number}`,
                author: number === 102 ? "designer" : "reviewer",
                draft: number === 102,
                createdAt: "2026-09-16T12:00:00Z",
                head: "feat/review",
                base: "main",
                headSha: "head",
                baseSha: "base",
              })),
            hasMore: args.repo === "zed/mono" && args.page === 1,
          };
        }
        if (command === "get_service_labels") {
          if (win.serviceError) throw "PR mudou durante a consulta";
          return {
            labels:
              args.number === 102
                ? ["Web"]
                : args.number === 103
                  ? ["API", "Web"]
                  : ["API"],
            outside: args.number === 103,
          };
        }
        if (command === "get_auth_status")
          return (
            win.testAuth ?? {
              state: "authenticated",
              login: "reviewer",
              message: "Sua conta está pronta para abrir pull requests.",
            }
          );
        if (command === "load_progress")
          return JSON.parse(
            localStorage.getItem("test-progress") ||
              '{"schema":1,"lastUrl":"","reviews":{}}',
          );
        if (command === "save_progress") {
          if (win.failSave) throw "Disco indisponível";
          const saved = JSON.parse(
            localStorage.getItem("test-progress") ||
              '{"schema":1,"lastUrl":"","reviews":{}}',
          );
          saved.lastUrl = args.url;
          saved.reviews[args.key] = args.review;
          localStorage.setItem("test-progress", JSON.stringify(saved));
          return;
        }
        if (command === "open_pr") {
          if (args.url.includes("error")) throw "Sem acesso à PR";
          if (win.newPush)
            return {
              ...snapshot,
              id: "new",
              headSha: "new5678",
              files: files.map((f) => ({ ...f, version: "v2" })),
            };
          return snapshot;
        }
        const textFor = (path: string) =>
          (path === "src/controller.ts"
            ? "import { calculateTotal } from '@/utils';\nexport function controller() { return calculateTotal(2); }\n"
            : path === "src/utils.ts"
              ? win.chainedImports
                ? "export { calculateTotal } from './pricing';\n"
                : "export function calculateTotal(value: number) {\n  return value * 10;\n}\n"
              : path === "src/pricing.ts"
                ? "import './utils';\nexport function calculateTotal(value: number) { return value * 10; }\n"
                : "export {};\n") +
          Array.from(
            { length: 200 },
            (_, i) => `const line${i} = "${path}";`,
          ).join("\n");
        if (command === "get_pr_files")
          return {
            snapshot,
            files: Object.fromEntries(
              files.map((f) => [
                f.path,
                {
                  path: f.path,
                  before:
                    f.status === "added"
                      ? ""
                      : textFor(f.path).replace("* 10", "* 5"),
                  after: f.path.endsWith(".png") ? null : textFor(f.path),
                  diff: {
                    patch: f.path.endsWith(".png")
                      ? null
                      : "@@ -1,203 +1,203 @@\n",
                    reason: f.path.endsWith(".png")
                      ? "Arquivo binário; revisão textual indisponível."
                      : null,
                    reviewable: !f.path.endsWith(".png"),
                  },
                },
              ]),
            ),
          };
        if (command === "get_code_definitions") {
          win.lastDefinition = args;
          if (win.definitionError) throw "Falha ao ler índice local";
          return {
            targets: [
              {
                path: "python/service.py",
                line: 1,
                column: 5,
                endLine: 1,
                endColumn: 14,
              },
              {
                path: "python/other.py",
                line: 1,
                column: 5,
                endLine: 1,
                endColumn: 14,
              },
            ],
            warnings: ["Índice de declarações parcial: fixture"],
            indexedFiles: 3,
          };
        }
        if (command === "get_repository_index")
          return {
            head: [
              ...Array.from({ length: 2100 }, (_, i) => ({
                path: `unrelated/module-${i}.ts`,
                oid: "u",
                mode: "100644",
                size: 8000,
              })),
              {
                path: "tsconfig.json",
                oid: "config",
                mode: "100644",
                size: 150,
              },
              ...files.map((f) => ({
                path: f.path,
                oid: "abc",
                mode: "100644",
                size: 3000,
              })),
              { path: "src/utils.ts", oid: "def", mode: "100644", size: 3000 },
              {
                path: "src/pricing.ts",
                oid: "pricing",
                mode: "100644",
                size: 3000,
              },
              { path: "python/caller.py", oid: "py", mode: "100644", size: 50 },
            ],
            base: [
              {
                path: "tsconfig.json",
                oid: "config",
                mode: "100644",
                size: 150,
              },
              {
                path: "src/utils.ts",
                oid: "helper-base",
                mode: "100644",
                size: 3000,
              },
              ...files
                .filter((f) => f.status !== "added")
                .map((f) => ({
                  path: f.path,
                  oid: "abc",
                  mode: "100644",
                  size: 3000,
                })),
            ],
            analysis: [],
            warnings: [],
          };
        if (
          command === "read_repository_files" ||
          command === "read_repository_file"
        ) {
          win.codeReads ??= [];
          const paths =
            command === "read_repository_files" ? args.paths : [args.path];
          win.codeReads.push({ side: args.side, paths });
          const docs = paths.map((path: string) => ({
            path,
            side: args.side,
            text:
              path === "tsconfig.json"
                ? JSON.stringify({
                    compilerOptions: {
                      baseUrl: ".",
                      paths: { "@/*": ["src/*"] },
                    },
                  })
                : path.endsWith(".py")
                  ? path.endsWith("caller.py")
                    ? "from service import calculate\ncalculate(2)\n"
                    : `def calculate(value):\n    return value * ${path.includes("other") ? 3 : 2}\n`
                  : textFor(path).replace(
                      "* 10",
                      args.side === "base" ? "* 5" : "* 10",
                    ),
            reason: null,
          }));
          return command === "read_repository_files" ? docs : docs[0];
        }
        if (
          [
            "load_review_drafts",
            "save_review_drafts",
            "submit_review_drafts",
            "check_review_submission",
          ].includes(command)
        ) {
          let draft = JSON.parse(
            localStorage.getItem("test-drafts") ??
              '{"snapshotId":"","revision":0,"comments":[],"state":"ready","batchId":"","lastUrl":null}',
          );
          if (command === "save_review_drafts") {
            if (win.draftSaveError) throw "Disco indisponível";
            if (draft.revision !== args.revision) throw "Lista alterada";
            draft = {
              ...draft,
              snapshotId: args.snapshotId,
              revision: draft.revision + 1,
              comments: args.comments,
            };
          }
          if (command === "submit_review_drafts") {
            if (win.commentError) throw "A PR mudou. Rascunhos preservados";
            win.submissions ??= [];
            win.submissions.push(draft.comments);
            if (win.uncertainSubmission) {
              draft.state = "uncertain";
              localStorage.setItem("test-drafts", JSON.stringify(draft));
              throw "Envio sem confirmação";
            }
            draft = {
              ...draft,
              revision: draft.revision + 1,
              comments: [],
              lastUrl: "https://github.com/acme/project/pull/42#review-1",
            };
          }
          if (command === "check_review_submission")
            draft = {
              ...draft,
              state: "ready",
              comments: [],
              revision: draft.revision + 1,
              lastUrl: "https://github.com/acme/project/pull/42#review-1",
            };
          localStorage.setItem("test-drafts", JSON.stringify(draft));
          return draft;
        }
        if (command === "get_diff") {
          if (args.path.endsWith(".png"))
            return {
              patch: null,
              reason: "Arquivo binário; revisão textual indisponível.",
              reviewable: false,
            };
          if (args.path.includes("controller") || args.path.includes("case-0"))
            await new Promise((resolve) => setTimeout(resolve, 120));
          const lines = Array.from(
            { length: 200 },
            (_, i) => `+const line${i} = "${args.path}";`,
          ).join("\n");
          return {
            patch: `diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -0,0 +1,200 @@\n${lines}\n`,
            reason: null,
            reviewable: true,
          };
        }
        if (command.startsWith("plugin:event|")) return 1;
        throw new Error(`Unexpected IPC: ${command}`);
      },
    };
  });
  await page.goto("/");
});
async function open(page: import("@playwright/test").Page) {
  await page
    .getByLabel("URL da pull request")
    .fill("https://github.com/acme/project/pull/42");
  await page.getByRole("button", { name: "Abrir PR" }).click();
  await expect(page.getByLabel("Marcar arquivo como revisado")).toBeEnabled();
  await page.getByRole("button", { name: "Mostrar arquivos" }).hover();
  await page
    .getByRole("button", { name: "Fixar explorador", exact: true })
    .click();
}
test("preserves scroll, reviewed state and selection across files and reload", async ({
  page,
}) => {
  await open(page);
  const pane = page.locator('[data-testid="diff-editor"] .editor.modified');
  const scrollTop = () =>
    pane
      .locator(".scrollbar.vertical .slider")
      .first()
      .evaluate((el) => (el as HTMLElement).offsetTop);
  await pane.hover();
  await page.mouse.wheel(0, 1300);
  await expect.poll(scrollTop).toBeGreaterThan(0);
  const savedTop = await scrollTop();
  await page.getByLabel("Marcar arquivo como revisado").check();
  await page
    .getByRole("navigation", { name: "Arquivos alterados" })
    .getByRole("button", { name: /service.ts/ })
    .click();
  await expect(page.getByLabel("Marcar arquivo como revisado")).toBeEnabled();
  await expect.poll(scrollTop).toBe(0);
  await page
    .getByRole("navigation", { name: "Arquivos alterados" })
    .getByRole("button", { name: /controller.ts/ })
    .click();
  // The scrollbar thumb rounds to physical pixels differently after layout.
  await expect
    .poll(async () => Math.abs((await scrollTop()) - savedTop))
    .toBeLessThanOrEqual(1);
  await expect(page.getByLabel("Marcar arquivo como revisado")).toBeChecked();
  await expect(page.getByText("Salvo neste dispositivo")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Marcar arquivo como revisado")).toBeChecked();
  // The scrollbar thumb rounds to physical pixels differently after layout.
  await expect
    .poll(async () => Math.abs((await scrollTop()) - savedTop))
    .toBeLessThanOrEqual(1);
  await expect(page.locator(".file-item.selected")).toContainText(
    "controller.ts",
  );
  await page.getByRole("button", { name: "Mostrar arquivos" }).hover();
  await expect(page.locator(".sidebar")).toBeInViewport();
  await expect(page.locator(".file-header")).toBeInViewport();
  await page.screenshot({
    path: `test-results/review-${test.info().project.name}.png`,
  });
});
test("blocks binaries and resets progress after a new push", async ({
  page,
}) => {
  await open(page);
  await page.getByLabel("Marcar arquivo como revisado").check();
  await page
    .getByRole("navigation", { name: "Arquivos alterados" })
    .getByRole("button", { name: /image.png/ })
    .click();
  await expect(
    page.getByText("Arquivo binário; revisão textual indisponível."),
  ).toBeVisible();
  await expect(page.getByLabel("Marcar arquivo como revisado")).toBeDisabled();
  await page.evaluate(() => {
    (window as any).newPush = true;
  });
  await page.getByRole("button", { name: "Abrir PR" }).click();
  await expect(page.getByRole("status")).toContainText("voltou/voltaram");
  await page.getByRole("button", { name: "Mostrar arquivos" }).hover();
  await page
    .getByRole("navigation", { name: "Arquivos alterados" })
    .getByRole("button", { name: /controller.ts/ })
    .click();
  await expect(
    page.getByLabel("Marcar arquivo como revisado"),
  ).not.toBeChecked();
});
test("filters pending files, ignores stale requests and reports save failures", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("navigation", { name: "Arquivos alterados" })
    .getByRole("button", { name: /service.ts/ })
    .click();
  await expect(page.getByLabel("Marcar arquivo como revisado")).toBeEnabled();
  await page.getByLabel("Marcar arquivo como revisado").check();
  await page.getByLabel("Apenas pendentes").check();
  await expect(
    page
      .getByRole("navigation", { name: "Arquivos alterados" })
      .getByRole("button", { name: /service.ts/ }),
  ).toHaveCount(0);
  await page.getByLabel("Filtrar arquivos").fill("controller");
  await page
    .getByRole("navigation", { name: "Arquivos alterados" })
    .getByRole("button", { name: /controller.ts/ })
    .click();
  await expect(page.locator(".file-heading")).toContainText("controller.ts");
  await page.evaluate(() => {
    (window as any).failSave = true;
  });
  await page.getByLabel("Marcar arquivo como revisado").check();
  await expect(page.locator(".banner[role=alert]")).toContainText(
    "Disco indisponível",
  );
  await page.evaluate(() => {
    (window as any).failSave = false;
  });
  await page.getByRole("button", { name: "Tentar salvar" }).click();
  await expect(page.locator(".banner[role=alert]")).toHaveCount(0);
});

test("rapid navigation never displays the previous request under the selected path", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: /case-0.ts/ }).click();
  await page
    .getByRole("navigation", { name: "Arquivos alterados" })
    .getByRole("button", { name: /service.ts/ })
    .click();
  await expect(page.getByLabel("Marcar arquivo como revisado")).toBeEnabled();
  await page.waitForTimeout(200); // Let the deliberately slow previous request finish.
  await expect(page.locator(".file-heading")).toContainText("src/service.ts");
  await expect(page.getByTestId("diff-editor")).toContainText("src/service.ts");
  await expect(page.getByTestId("diff-editor")).not.toContainText("case-0.ts");
});

test("shows the real account, login guidance, missing CLI and connection uncertainty", async ({
  page,
}) => {
  const card = page.getByRole("region", { name: "Conta do GitHub" });
  await expect(card).toContainText("@reviewer");
  await expect(card.locator("code")).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).testAuth = {
      state: "signedOut",
      login: null,
      message:
        "Entre na sua conta pelo terminal e clique em verificar novamente.",
    };
  });
  await page.getByLabel("Verificar autenticação novamente").click();
  await expect(card).toContainText("GitHub desconectado");
  await expect(card).toContainText("gh auth login --hostname github.com");
  await page.evaluate(() => {
    (window as any).testAuth = {
      state: "missing",
      login: null,
      message: "O Lince não encontrou o executável gh neste dispositivo.",
    };
  });
  await page.getByLabel("Verificar autenticação novamente").click();
  await expect(card).toContainText("GitHub CLI não encontrado");
  await page.evaluate(() => {
    (window as any).testAuth = {
      state: "unavailable",
      login: null,
      message: "Confira sua conexão.",
    };
  });
  await page.getByLabel("Verificar autenticação novamente").click();
  await expect(card).toContainText("Conexão não verificada");
  await expect(card.locator("code")).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).testAuth = {
      state: "authenticated",
      login: "reviewer",
      message: "Sua conta está pronta para abrir pull requests.",
    };
  });
  await page.getByLabel("Verificar autenticação novamente").click();
  await expect(card).toContainText("@reviewer");
  await expect(page.locator(".titlebar")).toBeVisible();
  await expect(page.getByAltText("Logo do Lince")).toBeVisible();
  await page.screenshot({
    path: `test-results/identity-${test.info().project.name}.png`,
  });
});

test("lists affiliated repos, prioritizes history, filters and opens PRs", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Listar PRs" }).click();
  await expect(page.getByText("3 repositórios disponíveis")).toBeVisible();
  await expect(page.locator(".repo-group").first()).toHaveAttribute(
    "aria-label",
    "zed/mono",
  );
  await expect(
    page.getByRole("button", { name: "Improve API request validation" }),
  ).toBeVisible();
  await expect(
    page.locator(".pr-card").first().locator(".service-label"),
  ).toHaveText("API");
  await expect(
    page.locator(".pr-card").first().getByAltText("Avatar de reviewer"),
  ).toHaveAttribute("src", "https://github.com/reviewer.png?size=68");
  await page
    .getByRole("combobox", { name: "Serviço / codebase", exact: true })
    .click();
  await page.getByRole("option", { name: "API", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Refresh Web dashboard" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Carregar mais PRs de zed/mono" })
    .click();
  await expect(
    page.getByRole("button", { name: "Share auth across services" }),
  ).toBeVisible();
  await expect(
    page.getByText("Fora das codebases", { exact: true }).last(),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Serviço / codebase", exact: true })
    .click();
  await page.getByRole("option", { name: "Todas as codebases" }).click();
  await page
    .getByRole("combobox", { name: "Repositório", exact: true })
    .click();
  await page.getByLabel("Buscar em Repositório").fill("acme");
  await page.getByRole("option", { name: "acme/project" }).click();
  await expect(page.locator(".repo-group")).toHaveCount(1);
  await page.getByRole("button", { name: "Preserve review context" }).click();
  await expect(page.getByLabel("Marcar arquivo como revisado")).toBeEnabled();
});

test("configures service paths persistently and displays discovery failures", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Listar PRs" }).click();
  await page
    .getByRole("button", { name: "Configurar codebases de zed/mono" })
    .click();
  await page
    .getByLabel("Caminhos e nomes dos serviços")
    .fill("apps/api = API\napps/web = Web\npackages/auth = Auth");
  await page.getByRole("button", { name: "Salvar configuração" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Listar PRs" }).click();
  await page
    .getByRole("button", { name: "Configurar codebases de zed/mono" })
    .click();
  await expect(page.getByLabel("Caminhos e nomes dos serviços")).toHaveValue(
    "apps/api = API\napps/web = Web\npackages/auth = Auth",
  );
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(
    page.getByRole("button", { name: "Improve API request validation" }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/discovery-${test.info().project.name}.png`,
  });
  await page.evaluate(() => {
    (window as any).catalogError = true;
  });
  await page.getByRole("button", { name: "Atualizar", exact: false }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Falha ao buscar repositórios",
  );
  await page.evaluate(() => {
    (window as any).catalogError = false;
    (window as any).serviceError = true;
  });
  await page
    .getByRole("button", { name: "Tentar novamente", exact: true })
    .click();
  await expect(
    page.getByText("Serviços não identificados", { exact: false }).first(),
  ).toBeVisible();
});

test("filters by PR author with searchable avatars and returns home via logo", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Listar PRs" }).click();
  await expect(
    page.getByRole("button", { name: "Refresh Web dashboard" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Autor da PR", exact: true })
    .click();
  await page.getByLabel("Buscar em Autor da PR").fill("designer");
  await expect(
    page
      .getByRole("option", { name: "@designer" })
      .getByAltText("Avatar de designer"),
  ).toBeVisible();
  await page.getByLabel("Buscar em Autor da PR").press("Enter");
  await expect(
    page.getByRole("button", { name: "Refresh Web dashboard" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Improve API request validation" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Voltar para a home do Lince" })
    .click();
  await expect(page.getByRole("button", { name: "Listar PRs" })).toBeVisible();
  await expect(page.locator(".pr-browser")).toHaveCount(0);
});

test("offers updates, reports download errors and installs on retry", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).testUpdates = true;
    (window as any).updateFail = true;
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Atualizar Lince para 0.2.0" })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Falha no download",
  );
  await page.evaluate(() => {
    (window as any).updateFail = false;
  });
  await page
    .getByRole("button", { name: "Tentar novamente", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).updateInstalled && (window as any).restarted,
      ),
    )
    .toBe(true);
});

test("history persists progress, filters and resumes the selected file", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Histórico", exact: false }).click();
  await expect(page.getByText("Seu histórico começa aqui")).toBeVisible();
  await page
    .getByRole("button", { name: "Voltar para a home do Lince" })
    .click();
  await page
    .getByLabel("URL da pull request")
    .fill("https://github.com/acme/project/pull/42");
  await page.getByRole("button", { name: "Abrir PR", exact: false }).click();
  await page.getByLabel("Marcar arquivo como revisado").check();
  await page.getByRole("button", { name: "Histórico", exact: false }).click();
  await expect(page.getByText("1 / 153 arquivos revisados")).toBeVisible();
  await page.screenshot({
    path: `test-results/history-${test.info().project.name}.png`,
  });
  await page.getByPlaceholder("Repositório ou #número…").fill("missing");
  await expect(page.getByText("Nenhuma revisão neste filtro")).toBeVisible();
  await page.getByPlaceholder("Repositório ou #número…").fill("#42");
  await page
    .getByRole("button", { name: "Retomar acme/project#42", exact: true })
    .click();
  await expect(page.getByLabel("Marcar arquivo como revisado")).toBeChecked();
  await page.reload();
  await page.getByRole("button", { name: "Histórico", exact: false }).click();
  await expect(page.getByText("1 / 153 arquivos revisados")).toBeVisible();
  await page.evaluate(() => {
    (window as any).historyError = true;
  });
  await page
    .getByRole("button", { name: "Voltar", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "Histórico", exact: false }).click();
  await expect(page.locator('.banner[role="alert"]')).toContainText(
    "Histórico indisponível",
  );
  await page.evaluate(() => {
    (window as any).historyError = false;
  });
  await page
    .getByRole("button", { name: "Tentar novamente", exact: true })
    .click();
  await expect(page.getByText("1 / 153 arquivos revisados")).toBeVisible();
});

test("repo notifications opt in persists, permission denial and poll errors are visible", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Listar PRs" }).click();
  const toggle = page.getByRole("button", {
    name: "Avisar novas PRs de zed/mono",
    exact: true,
  });
  await page.evaluate(() => {
    (window as any).denyNotifications = true;
  });
  await toggle.click();
  await expect(page.getByRole("alert")).toContainText(
    "Notificações bloqueadas",
  );
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(() => {
    (window as any).denyNotifications = false;
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await page.getByRole("button", { name: "Listar PRs" }).click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => {
    (window as any).pollError = true;
  });
  await page
    .getByRole("button", { name: "Verificar alertas de novas PRs" })
    .click();
  await expect(page.getByRole("alert")).toContainText("GitHub indisponível");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});

test("navigates to unchanged definitions, previews them and keeps source read-only", async ({
  page,
}) => {
  await open(page);
  const call = page
    .locator(".monaco-diff-editor .editor.modified .view-lines")
    .getByText("calculateTotal", { exact: true })
    .last();
  await call.click();
  await page
    .getByRole("button", { name: "Prévia da definição", exact: false })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("dialog").getByRole("heading")).toContainText(
    "src/utils.ts",
  );
  await expect(page.getByRole("dialog").locator(".view-lines")).toContainText(
    "value * 10",
  );
  await page.getByRole("button", { name: "Abrir arquivo nesta linha" }).click();
  await expect(page.locator(".file-heading")).toContainText("src/utils.ts");
  await expect(page.locator(".file-heading")).toContainText(
    "arquivo de contexto",
  );
  await page.getByTestId("source-editor").locator("textarea").press("End");
  await page.keyboard.type("SHOULD_NOT_EDIT");
  await expect(
    page.getByTestId("source-editor").locator(".view-lines"),
  ).not.toContainText("SHOULD_NOT_EDIT");
  await page.getByRole("button", { name: "Voltar na navegação" }).click();
  await expect(page.locator(".file-heading")).toContainText(
    "src/controller.ts",
  );
  await page.getByRole("button", { name: "Avançar na navegação" }).click();
  await expect(page.locator(".file-heading")).toContainText("src/utils.ts");
  await page.getByRole("button", { name: "Voltar na navegação" }).click();
  await call.click({ modifiers: ["Meta"] });
  await expect(page.locator(".file-heading")).toContainText("src/utils.ts", {
    timeout: 15000,
  });
  await page.screenshot({
    path: `test-results/code-workspace-${test.info().project.name}.png`,
  });
});

test("saves local comments, persists them and publishes only after apply all", async ({
  page,
}) => {
  await open(page);
  await page.locator(".editor.modified .comment-add-glyph").first().click();
  await page
    .getByLabel("Comentário da revisão")
    .fill("Podemos simplificar esta função?");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).submissions ?? [])).toEqual(
    [],
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Comentários (1)", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Podemos simplificar");
  await page.evaluate(() => {
    (window as any).commentError = true;
  });
  await page
    .getByRole("button", { name: "Aplicar tudo (1)", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "A PR mudou",
  );
  await page.evaluate(() => {
    (window as any).commentError = false;
  });
  await page
    .getByRole("button", { name: "Aplicar tudo (1)", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Todos os comentários foram publicados",
  );
  expect(await page.evaluate(() => (window as any).submissions)).toHaveLength(
    1,
  );
  await page.getByRole("button", { name: "Fechar comentários" }).click();
  await page.keyboard.press("Meta+p");
  await page.getByLabel("Ir ao arquivo", { exact: true }).fill("utils");
  await page.getByLabel("Ir ao arquivo", { exact: true }).press("Enter");
  await expect(
    page.locator('[data-testid="source-editor"] .comment-add-glyph'),
  ).toHaveCount(0);
});

test("base references stay on the base snapshot with tsconfig aliases", async ({
  page,
}) => {
  await open(page);
  const call = page
    .locator(".monaco-diff-editor .editor.original .view-lines")
    .getByText("calculateTotal", { exact: true })
    .last();
  await call.click();
  await page.keyboard.press("F12");
  await expect(page.locator(".file-heading")).toContainText("src/utils.ts", {
    timeout: 15000,
  });
  await expect(page.locator(".file-heading")).toContainText("Base comum");
  await expect(
    page.getByTestId("source-editor").locator(".view-lines"),
  ).toContainText("value * 5");
});

test("compact workspace gives code the space and reveals explorer by hover or keyboard", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Desafixar explorador" }).click();
  await page.getByTestId("diff-editor").click({ position: { x: 500, y: 100 } });
  const toggle = page.getByRole("button", { name: "Mostrar arquivos" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#file-explorer")).toBeHidden();
  const before = await page.getByTestId("diff-editor").boundingBox();
  expect(before!.width).toBeGreaterThan(1380);
  expect(before!.height).toBeGreaterThan(620);
  await toggle.hover();
  await expect(
    page.getByRole("navigation", { name: "Arquivos alterados" }),
  ).toBeVisible();
  expect((await page.getByTestId("diff-editor").boundingBox())!.width).toBe(
    before!.width,
  );
  await page.getByTestId("diff-editor").hover({ position: { x: 500, y: 100 } });
  await expect(page.locator("#file-explorer")).toBeHidden();
  // Keyboard focus reveals the same panel and Escape returns to code.
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#file-explorer")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#file-explorer")).toBeHidden();
  await page.getByLabel("Detalhes da PR").click();
  await expect(page.locator(".pr-details-popover")).toContainText(
    "feat/review",
  );
  await page.getByLabel("Detalhes da PR").click();
  await page.screenshot({
    path: `test-results/compact-${test.info().project.name}.png`,
  });
});

test("underlines the full import path and opens its target", async ({
  page,
}) => {
  await open(page);
  const lines = page.locator(
    ".monaco-diff-editor .editor.modified .view-lines",
  );
  const path = lines.getByText("'@/utils'", { exact: true });
  await page.keyboard.down("Meta");
  await path.hover();
  await expect(lines.locator(".goto-definition-link")).toHaveText("@/utils", {
    timeout: 15000,
  });
  await lines.locator(".goto-definition-link").click({ modifiers: ["Meta"] });
  await page.keyboard.up("Meta");
  await expect(page.locator(".file-heading")).toContainText("src/utils.ts", {
    timeout: 15000,
  });
});

test("previews syntax candidates outside the diff, exposes limits and stays read-only", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("Meta+p");
  await page.getByLabel("Ir ao arquivo", { exact: true }).fill("python/caller");
  await page.getByLabel("Ir ao arquivo", { exact: true }).press("Enter");
  const call = page
    .getByTestId("source-editor")
    .locator(".view-lines")
    .getByText("calculate", { exact: true })
    .last();
  await call.click();
  await page
    .getByRole("button", { name: "Prévia da definição", exact: false })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Declarações candidatas por sintaxe");
  await expect(dialog.locator(".view-lines")).toContainText("value * 2");
  await page.getByRole("button", { name: "python/other.py:1" }).click();
  await expect(dialog.locator(".view-lines")).toContainText("value * 3");
  await dialog.locator("textarea").press("End");
  await page.keyboard.type("DO_NOT_EDIT");
  await expect(dialog.locator(".view-lines")).not.toContainText("DO_NOT_EDIT");
  await page.getByRole("button", { name: "Fechar prévia" }).click();
  await expect(
    page.getByRole("button", { name: "Referências", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".code-workspace")).toContainText(
    "Índice de declarações parcial",
  );
  expect(await page.evaluate(() => (window as any).lastDefinition.side)).toBe(
    "head",
  );
});

test("loads JS dependencies on demand beyond 2000 unrelated files and only on requested side", async ({
  page,
}) => {
  await open(page);
  expect(await page.evaluate(() => (window as any).codeReads ?? [])).toEqual(
    [],
  );
  const call = page
    .locator(".monaco-diff-editor .editor.modified .view-lines")
    .getByText("calculateTotal", { exact: true })
    .last();
  await call.click();
  await page
    .getByRole("button", { name: "Prévia da definição", exact: false })
    .click();
  await expect(page.getByRole("dialog").getByRole("heading")).toContainText(
    "src/utils.ts",
    { timeout: 15000 },
  );
  const reads = await page.evaluate(() => (window as any).codeReads);
  expect(reads.every((r: any) => r.side === "head")).toBe(true);
  expect(reads.flatMap((r: any) => r.paths).sort()).toEqual([
    "src/utils.ts",
    "tsconfig.json",
  ]);
  await expect(page.locator(".code-workspace")).not.toContainText(
    "Índice de JS/TS parcial",
  );
  await page.getByRole("button", { name: "Fechar prévia" }).click();
  await call.click();
  await page
    .getByRole("button", { name: "Prévia da definição", exact: false })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => (window as any).codeReads.length)).toBe(
    reads.length,
  );
});

test("follows re-exports and terminates circular dependency graphs", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).chainedImports = true;
  });
  await open(page);
  await page
    .locator(".monaco-diff-editor .editor.modified .view-lines")
    .getByText("calculateTotal", { exact: true })
    .last()
    .click();
  await page
    .getByRole("button", { name: "Prévia da definição", exact: false })
    .click();
  await expect(page.getByRole("dialog").getByRole("heading")).toContainText(
    "src/pricing.ts",
    { timeout: 15000 },
  );
  const paths = await page.evaluate(() =>
    (window as any).codeReads.flatMap((r: any) => r.paths),
  );
  expect(paths.sort()).toEqual([
    "src/pricing.ts",
    "src/utils.ts",
    "tsconfig.json",
  ]);
});

test("gutter click and drag compose single and multiline drafts on both sides", async ({
  page,
}) => {
  await open(page);
  const right = page.locator(".editor.modified .comment-add-glyph");
  await right.nth(1).click();
  await expect(
    page.getByRole("region", { name: "Comentário nas linhas selecionadas" }),
  ).toContainText("head · linha 2");
  await page.getByLabel("Comentário da revisão").fill("Um comentário de linha");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.locator(".inline-comment-form")).toHaveCount(0);
  const left = page.locator(".editor.original .line-numbers");
  await left.filter({ hasText: /^4$/ }).hover();
  const first = await left.filter({ hasText: /^4$/ }).boundingBox(),
    last = await left.filter({ hasText: /^6$/ }).boundingBox();
  await page.mouse.move(
    first!.x + first!.width / 2,
    first!.y + first!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(last!.x + last!.width / 2, last!.y + last!.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(
    page.getByRole("region", { name: "Comentário nas linhas selecionadas" }),
  ).toContainText("base · linhas 4–6");
  await page
    .getByLabel("Comentário da revisão")
    .fill("Este trecho inteiro merece revisão");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.locator(".editor.original .inline-comment-form"),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/inline-comment-${test.info().project.name}.png`,
  });
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  expect(await page.evaluate(() => (window as any).submissions ?? [])).toEqual(
    [],
  );
  await page
    .getByRole("button", { name: "Comentários (2)", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Editar comentário 1", exact: true })
    .click();
  await page.getByLabel("Comentário da revisão").fill("Comentário editado");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await page
    .getByRole("button", { name: "Comentários (2)", exact: true })
    .click();
  await page.screenshot({
    path: `test-results/comments-${test.info().project.name}.png`,
  });
  await page
    .getByRole("button", { name: "Aplicar tudo (2)", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Todos os comentários foram publicados",
  );
  const sent = await page.evaluate(() => (window as any).submissions);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toHaveLength(2);
  expect(sent[0][0].body).toBe("Comentário editado");
  expect(sent[0][1]).toMatchObject({ side: "LEFT", startLine: 4, line: 6 });
});

test("uncertain submissions are reconciled without posting a second batch", async ({
  page,
}) => {
  await open(page);
  await page.locator(".editor.modified .comment-add-glyph").first().click();
  await page
    .getByLabel("Comentário da revisão")
    .fill("Verificar erro de transporte");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await page
    .getByRole("button", { name: "Comentários (1)", exact: true })
    .click();
  await page.evaluate(() => {
    (window as any).uncertainSubmission = true;
  });
  await page
    .getByRole("button", { name: "Aplicar tudo (1)", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Verificar envio", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Liberar nova tentativa", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Verificar envio", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Envio confirmado");
  expect(await page.evaluate(() => (window as any).submissions)).toHaveLength(
    1,
  );
});

test("draft save failures preserve text and outdated drafts remain local", async ({
  page,
}) => {
  await open(page);
  await page.locator(".editor.modified .comment-add-glyph").first().click();
  await page.getByLabel("Comentário da revisão").fill("Não perder este texto");
  await page.evaluate(() => {
    (window as any).draftSaveError = true;
  });
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(
    page.getByRole("region", { name: "Comentário nas linhas selecionadas" }),
  ).toContainText("Disco indisponível");
  await expect(page.getByLabel("Comentário da revisão")).toHaveValue(
    "Não perder este texto",
  );
  await page.evaluate(() => {
    (window as any).draftSaveError = false;
  });
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await page
    .getByRole("button", { name: "Comentários (1)", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remover comentário 1", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Aplicar tudo (0)", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Fechar comentários" }).click();
  await page.locator(".editor.modified .comment-add-glyph").first().click();
  await page
    .getByLabel("Comentário da revisão")
    .fill("Rascunho de outra versão");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem("test-drafts")!);
    draft.snapshotId = "previous-snapshot";
    localStorage.setItem("test-drafts", JSON.stringify(draft));
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Comentários (1)", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "pertencem a outra versão",
  );
  await expect(page.getByRole("dialog")).toContainText(
    "Rascunho de outra versão",
  );
  await expect(
    page.getByRole("button", { name: "Aplicar tudo (1)", exact: true }),
  ).toBeDisabled();
  expect(await page.evaluate(() => (window as any).submissions ?? [])).toEqual(
    [],
  );
});

test("context menus mark files and whole folders independently of filters", async ({
  page,
}) => {
  await open(page);
  const tree = page.getByRole("navigation", { name: "Arquivos alterados" });
  const controller = tree.getByRole("button", { name: /controller.ts/ });
  await controller.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Marcar como visto", exact: false })
    .click();
  await expect(
    controller.getByLabel("Revisado", { exact: true }),
  ).toBeVisible();
  const folder = tree.locator('summary[title="src"]');
  await expect(folder).not.toContainText("✓");
  await page.getByLabel("Filtrar arquivos").fill("controller");
  await folder.click({ button: "right" });
  await expect(page.getByRole("menu")).toContainText("2 arquivos alterados");
  await page.getByRole("menuitem", { name: /Marcar como visto/ }).click();
  await expect(folder.getByLabel(/Pasta vista/)).toBeVisible();
  await page.getByLabel("Filtrar arquivos").fill("");
  await expect(
    tree
      .getByRole("button", { name: /service.ts/ })
      .getByLabel("Revisado", { exact: true }),
  ).toBeVisible();
  await folder.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Marcar como pendente/ }).click();
  await expect(folder).toContainText("0/2");
  await tree
    .getByRole("button", { name: /image.png/ })
    .click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: /Marcar como visto/ }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
});

test("approved unread stays distinct, persists and resets after a new push", async ({
  page,
}) => {
  await open(page);
  const tree = page.getByRole("navigation", { name: "Arquivos alterados" });
  await tree
    .getByRole("button", { name: /controller.ts/ })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: /Marcar como visto/ }).click();
  const service = tree.getByRole("button", { name: /service.ts/ });
  await service.focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: /Aprovado sem ler/ }).click();
  await expect(
    service.getByLabel("Aprovado sem ler", { exact: true }),
  ).toBeVisible();
  await expect(
    tree
      .locator('summary[title="src"]')
      .getByLabel(/concluída com arquivos não lidos/),
  ).toBeVisible();
  await expect(page.locator(".progress-summary")).toContainText("1 sem ler");
  await page.getByLabel("Apenas pendentes").check();
  await expect(service).toHaveCount(0);
  await expect(tree.getByRole("button", { name: /controller.ts/ })).toHaveCount(
    0,
  );
  await page.reload();
  await page.getByRole("button", { name: "Mostrar arquivos" }).hover();
  await expect(
    service.getByLabel("Aprovado sem ler", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as any).newPush = true;
  });
  await page.getByRole("button", { name: "Abrir PR" }).click();
  await page.getByRole("button", { name: "Mostrar arquivos" }).hover();
  await expect(service.getByLabel("Pendente", { exact: true })).toBeAttached();
  await expect(page.locator(".progress-summary")).not.toContainText("sem ler");
});

test("repository explorer shares folder review state and keeps unchanged files out", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Explorador", exact: true }).click();
  const tree = page.getByRole("navigation", {
    name: "Arquivos do repositório",
  });
  const folder = tree.getByRole("button", { name: /^src/ }).first();
  await folder.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Marcar como visto/ }).click();
  await expect(folder.getByLabel(/Pasta vista/)).toBeVisible();
  await tree
    .getByRole("button", { name: "utils.ts", exact: true })
    .click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: /Aprovado sem ler/ }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.screenshot({
    path: `test-results/folder-state-${test.info().project.name}.png`,
  });
});

test("inline comments follow reverse selection, preserve text across files and cancel with Escape", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  const editor = page.locator(".editor.modified");
  const lines = editor.locator(".line-numbers");
  await lines.filter({ hasText: /^9$/ }).hover();
  await expect(editor.locator(".comment-glyph-hover")).toHaveCount(1);
  const from = await lines.filter({ hasText: /^9$/ }).boundingBox();
  const to = await lines.filter({ hasText: /^6$/ }).boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  const form = page.getByRole("region", {
    name: "Comentário nas linhas selecionadas",
  });
  await expect(form).toContainText("head · linhas 6–9");
  await expect(editor.locator(".inline-comment-form")).toBeVisible();
  const lineBox = await lines.filter({ hasText: /^9$/ }).boundingBox();
  const formBox = await form.boundingBox();
  expect(formBox!.y).toBeGreaterThanOrEqual(lineBox!.y + lineBox!.height);
  expect(formBox!.y - lineBox!.y - lineBox!.height).toBeLessThan(20);
  await page.getByLabel("Comentário da revisão").fill("Texto ainda não salvo");
  const tree = page.getByRole("navigation", { name: "Arquivos alterados" });
  await tree.getByRole("button", { name: /service.ts/ }).click();
  await expect(form).toHaveCount(0);
  await tree.getByRole("button", { name: /controller.ts/ }).click();
  await expect(page.getByLabel("Comentário da revisão")).toHaveValue(
    "Texto ainda não salvo",
  );
  await page.getByLabel("Comentário da revisão").press("Escape");
  await expect(form).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Comentários (0)", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).submissions ?? [])).toEqual(
    [],
  );
  expect(errors).toEqual([]);
});
