import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as any;
    win.isTauri = true;
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
}
test("preserves scroll, reviewed state and selection across files and reload", async ({
  page,
}) => {
  await open(page);
  const pane = page.getByTestId("diff-scroll");
  await pane.evaluate((el) => {
    el.scrollTop = 1300;
    el.dispatchEvent(new Event("scroll"));
  });
  await page.getByLabel("Marcar arquivo como revisado").check();
  await page.getByRole("button", { name: /service.ts/ }).click();
  await expect(page.getByLabel("Marcar arquivo como revisado")).toBeEnabled();
  await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBe(0);
  await page.getByRole("button", { name: /controller.ts/ }).click();
  await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBe(1300);
  await expect(page.getByLabel("Marcar arquivo como revisado")).toBeChecked();
  await expect(page.getByText("Salvo neste dispositivo")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Marcar arquivo como revisado")).toBeChecked();
  await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBe(1300);
  await expect(page.locator(".file-item.selected")).toContainText(
    "controller.ts",
  );
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
  await page.getByRole("button", { name: /image.png/ }).click();
  await expect(
    page.getByText("Arquivo binário; revisão textual indisponível."),
  ).toBeVisible();
  await expect(page.getByLabel("Marcar arquivo como revisado")).toBeDisabled();
  await page.evaluate(() => {
    (window as any).newPush = true;
  });
  await page.getByRole("button", { name: "Abrir PR" }).click();
  await expect(page.getByRole("status")).toContainText("voltou/voltaram");
  await page.getByRole("button", { name: /controller.ts/ }).click();
  await expect(
    page.getByLabel("Marcar arquivo como revisado"),
  ).not.toBeChecked();
});
test("filters pending files, ignores stale requests and reports save failures", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: /service.ts/ }).click();
  await expect(page.getByLabel("Marcar arquivo como revisado")).toBeEnabled();
  await page.getByLabel("Marcar arquivo como revisado").check();
  await page.getByLabel("Apenas pendentes").check();
  await expect(page.getByRole("button", { name: /service.ts/ })).toHaveCount(0);
  await page.getByLabel("Filtrar arquivos").fill("controller");
  await page.getByRole("button", { name: /controller.ts/ }).click();
  await expect(page.locator(".file-heading")).toContainText("controller.ts");
  await page.evaluate(() => {
    (window as any).failSave = true;
  });
  await page.getByLabel("Marcar arquivo como revisado").check();
  await expect(page.getByRole("alert")).toContainText("Disco indisponível");
  await page.evaluate(() => {
    (window as any).failSave = false;
  });
  await page.getByRole("button", { name: "Tentar salvar" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("rapid navigation never displays the previous request under the selected path", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: /case-0.ts/ }).click();
  await page.getByRole("button", { name: /service.ts/ }).click();
  await expect(page.getByLabel("Marcar arquivo como revisado")).toBeEnabled();
  await page.waitForTimeout(200); // Let the deliberately slow previous request finish.
  await expect(page.locator(".file-heading")).toContainText("src/service.ts");
  await expect(page.locator(".diff")).toContainText("src/service.ts");
  await expect(page.locator(".diff")).not.toContainText("case-0.ts");
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
