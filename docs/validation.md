# Validação

## Menus de contexto e decisões de leitura — 18/09/2026

- 50 cenários Playwright passaram no build de produção em Chromium e WebKit, incluindo o fluxo de comentários em lote. Os novos testes cobrem marcação por arquivo/pasta, filtros, árvores de alterações/repositório, atalho Shift+F10, distinção de aprovado sem ler, persistência e invalidação após novo push.
- 26 testes Rust passaram (2 de rede ignorados), incluindo migração SQLite 4→5, preservação de vistos, contagens separadas no histórico e rollback de decisões contraditórias. Os 13 testes Vitest passaram, incluindo agregação de pastas aninhadas e invalidação de aprovação sem leitura.
- Clippy, Prettier, build de produção e build Tauri macOS arm64 passaram. Screenshot inspecionado; a inspeção identificou e corrigiu o foco do menu quando todas as ações estão desabilitadas, com teste de Escape acrescentado.
- Estados de leitura são locais; nenhum comentário ou aprovação real foi publicado. Windows/Linux nativos e interação no WebView nativo continuam sem validação local.

## Comentários locais por intervalo e envio em lote — 18/09/2026

- 25 testes Rust passaram (2 de rede ignorados), 11 testes Vitest passaram, Clippy com `-D warnings`, Prettier e build de produção passaram. Migração SQLite 3→4, concorrência, congelamento do lote, intervalos e payloads multilinha cobertos.
- 43/44 cenários Playwright passaram de primeira no build de produção em Chromium/WebKit. O restante comparava o pixel arredondado da barra de scroll; com tolerância de um pixel, passou na repetição WebKit. Todos os novos cenários passaram: clique/arraste nos dois lados, edição/remoção, persistência, falha de disco, snapshot antigo, envio explícito e reconciliação sem duplicação. Screenshot da lista de comentários inspecionado.
- Build Tauri macOS arm64 `--debug --no-bundle` passou após liberar o cache incremental temporário: a primeira tentativa esgotou o espaço em disco.
- GitHub é simulado nos testes de UI; nenhum comentário real foi publicado. Windows/Linux nativos e interação no WebView nativo permanecem sem validação local.

## Dependências JS/TS por demanda e ícones Material — 18/09/2026

- Removido o pré-carregamento inicial de JS/TS. O teste usa mais de 2.100 arquivos não relacionados e verifica que uma definição carrega apenas o `tsconfig` e a dependência consultada, sem ler a base ou os demais módulos. Repetir a consulta reutiliza os documentos.
- Teste adicional cobre re-export transitivo e ciclo de imports. A resolução usa o parser/resolvedor TypeScript do worker Monaco, sem regex de imports. Os cenários existentes continuam cobrindo aliases, lado antigo, previews somente leitura, scroll e links completos.
- Os 38 cenários Playwright passaram no build de produção (Chromium/WebKit), além dos 22 testes Rust e 9 testes unitários frontend. A fixture Git também valida a nova leitura em lote, isolamento de lados, caminhos inválidos, tamanho do lote e ausência de documentos de análise na abertura.
- Build web, build desktop macOS arm64 (`--debug --no-bundle`), Clippy e formatação passaram. Ícones Material Icon Theme 5.38.1 incorporados como SVGs locais, com licença MIT; screenshot da árvore inspecionado.
- O worker estendido tem ~7,03 MB. O empacotador também emite o worker padrão do Monaco, não utilizado para as consultas customizadas; isso acrescenta tamanho aos assets de distribuição. O módulo de revisão é ~4 MB antes de gzip. A home continua carregada separadamente.
- Limitações: referências são relativas ao grafo carregado; `extends`, project references, dependências externas e scripts globais não importados não são resolvidos automaticamente. Há orçamento de proteção por consulta. Isso ainda não equivale à infraestrutura completa do VS Code. Windows/Linux nativos continuam sem validação local.

## Previews em dez linguagens e layout compacto — 18/09/2026

- Build de produção e 9 testes unitários frontend passaram com Node 24 LTS.
- **34 cenários Playwright passaram no build de produção**, em Chromium e WebKit. Novos cenários verificam: caminho completo do import sublinhado e clicável; explorador recolhido/hover/teclado/fixação; ganho de espaço sem redimensionar o diff no hover; candidatos de definição Python, ambiguidade, índice parcial e preview somente leitura.
- **22 testes Rust passaram**, com 2 de rede ignorados por padrão. Os novos testes executam as oito gramáticas reais: funções e tipos em outro arquivo, posições Unicode/UTF-16, nomes duplicados, exclusão de comentários/strings e posições inválidas. A fixture Git testa leitura em lote e isolamento das declarações entre base e head.
- Build Tauri macOS arm64 `--debug --no-bundle` passou com as oito gramáticas incorporadas. Clippy com `-D warnings` e formatação passaram. O teste de UI usa IPC simulado; testes Rust usam os parsers e Git reais em arquivos temporários. Não foram baixadas PRs reais ou publicados comentários nesta atualização.
- Screenshot de 1440×940 inspecionado: editor com aproximadamente 1.400×675 px e árvore numa faixa de 40 px. O teste exige largura acima de 1.380 px e altura acima de 620 px; hover do painel mantém a largura do editor.
- JS/TS mantém resolução semântica. Nas oito linguagens adicionais a cobertura é de **declarações candidatas por sintaxe**, sem resolução de aliases, tipos ou sobrecargas. A interface informa essa diferença; veja [limites dos previews](code-workspace.md).
- Compilação/execução nativa Windows/Linux e desempenho em grandes monorepos continuam sem validação local.

## Workspace de código — 18/09/2026

- Node 24 LTS: build de produção, 9 testes unitários e Prettier passaram. Auditoria npm: zero vulnerabilidades após atualização do Monaco e override de DOMPurify.
- Rust: 19 testes passaram; 2 testes de rede ignorados por padrão. Clippy com `-D warnings` passou.
- Build Tauri `--debug --no-bundle` compilou o binário macOS arm64 com assets locais do editor e workers.
- Chromium/WebKit: 28 cenários passaram em desenvolvimento. No build de produção, 27 passaram na execução completa; o cenário restante exigiu restringir um seletor de alerta, pois Monaco cria regiões ARIA próprias. O cenário corrigido passou em ambos os browsers.
- Novos cenários: fonte somente leitura, definição fora do diff via Cmd+click, preview, histórico de navegação, busca rápida, aliases diretos de tsconfig e navegação isolada na base. Comentários usam IPC simulado, com envio explícito, erro de snapshot e retry; nenhum comentário foi publicado em uma PR real.
- Teste Rust de cache local valida objetos imutáveis, leitura de arquivo não alterado, reutilização e rejeição de caminho/lado inválidos, sem worktree. Teste real somente leitura com `cli/cli#14462` validou o fetch dos commits e preparação dos dois arquivos em cache temporário.
- Limites: não foi automatizada a interação no WebView nativo macOS; Chromium/WebKit de teste não substituem esse teste. Windows/Linux nativos, PR privada/fork privado, grandes monorepos e publicação real de comentários continuam sem validação nesta sessão. A resolução semântica cobre JS/TS com as restrições descritas em [code-workspace.md](code-workspace.md).
- O módulo Monaco tem ~3,95 MB e o worker TS ~7,03 MB antes de gzip. Carregamento é local e separado da home; o aviso de chunk grande do Vite permanece.

As seções abaixo são o histórico das validações anteriores; arquitetura e limites atuais estão em [code-workspace.md](code-workspace.md).

## Primeira versão — 16/09/2026

## Ambiente

macOS 26.6 / Darwin 25.6.0, Apple Silicon (arm64). Node **24.11.1 LTS**, npm fornecido com essa instalação, Rust/cargo 1.94.0, Git 2.50.1, GitHub CLI 2.87.3, Xcode em `/Applications/Xcode.app/Contents/Developer`.

O ambiente inicialmente usava Node 22; a implementação foi configurada e validada com Node 24 LTS, já instalado via mise. O projeto fixa a linha 24, não força esse patch antigo: mantenha atualizado para o patch mais recente da linha LTS. As versões resolvidas de dependências estão nos lockfiles.

## Executado

| Verificação | Resultado |
|---|---|
| TypeScript + Vite (`npm run build`) | Passou; bundle JS ~308 kB / ~97 kB gzip |
| Unitários frontend (`npm test`) | 6 passaram |
| Rust (`cargo test`) | 4 passaram; teste de rede ignorado por padrão |
| Rustfmt e Clippy (`-D warnings`) | Passaram |
| Build Tauri (`--debug --no-bundle`) | Compilou binário arm64 com assets incorporados |
| Inicialização do binário nativo | Processo iniciado sem erro de inicialização no macOS |
| Playwright Chromium | 4 cenários passaram |
| Playwright WebKit | 4 cenários passaram |
| Auditoria npm durante instalação final | Zero vulnerabilidades reportadas |
| GitHub CLI autenticado | Autenticação existente validada, sem novo login |
| Backend com PR pública real | Passou, descrito abaixo |

Os cenários visuais usam IPC simulado **somente nos testes**, com 153 arquivos e diffs de 200 linhas. Conferem: scroll preservado ao trocar e recarregar, seleção, marcação persistida, filtro de pendentes, binário bloqueado, invalidação após novo push, erro de gravação e retry, respostas fora de ordem. O screenshot de WebKit foi inspecionado; árvore, cabeçalho e rodapé permanecem visíveis enquanto só o diff rola. Isso não equivale a um benchmark com 12.000 linhas.

O backend real abriu `https://github.com/cli/cli/pull/14462`, com 2 arquivos, snapshot `189706bccb1686c68fb73c5bd9013358320a9e71`. Consultou a base comum, listou arquivos, resolveu árvores/blobs e calculou seus diffs. O teste é reproduzível com `live_public_pr`; a PR pode mudar ou deixar de estar acessível no futuro. Nenhum checkout foi criado ou alterado.

No ambiente de execução do agente, o sandbox bloqueava rede, chaveiro e portas locais. Consultas `gh`, downloads e browsers foram executados com a permissão de sistema apropriada. Um `gh auth status` isolado pelo sandbox reportou token inválido; fora do sandbox a mesma autenticação funcionou. Isso não era falha nas credenciais do usuário.

## Ainda não validado

- Compilação e execução **nativa** em Linux e Windows. A matriz `.github/workflows/ci.yml` foi preparada, mas não executada remotamente: esta pasta ainda não tem remoto.
- Interação automatizada na janela nativa macOS e fechamento/reabertura por controles nativos. Os fluxos da interface foram automatizados nos browsers, e persistência em disco testada separadamente no Rust.
- PR privada real (o fluxo usa as mesmas APIs com as permissões existentes do `gh`), SSO corporativo e GitHub Enterprise. Enterprise está fora do escopo.
- Paginação real com mais de 100 arquivos, PR com 3.000 arquivos, rate limits e corrida de push durante paginação. O backend implementa as verificações, mas esses cenários não foram reproduzidos contra o GitHub nesta sessão.
- Desempenho no limite de tamanho, leitores de tela, contraste auditado e seleção de texto em todas as WebViews nativas.
- Concorrência entre duas instâncias do app. Abra uma instância de cada vez.
- Queda de energia e encerramento forçado durante gravação. Há substituição atômica do JSON e sincronização do arquivo temporário, sem promessa de durabilidade absoluta contra falhas do filesystem.
- Build release, assinatura, instaladores, atualização automática e distribuição (fora do escopo).

## Roteiro manual recomendado

1. Executar `npm run tauri dev`, abrir uma PR autorizada e verificar título, branches e SHAs.
2. Rolar o arquivo A, abrir B, voltar a A; repetir horizontalmente numa linha longa.
3. Marcar A, fechar pela janela, abrir novamente: conferir seleção, posição e progresso.
4. Abrir inclusão, remoção, renomeação, modo executável e arquivo sem newline final.
5. Abrir binário, LFS, submódulo e arquivo grande: confirmar aviso e checkbox indisponível.
6. Fazer um novo push fora do Lince, reabrir a URL e confirmar invalidação explícita do progresso.
7. Repetir em Linux/WebKitGTK e Windows/WebView2, incluindo início pelo lançador gráfico com PATH reduzido.

## Atualização: autenticação e identidade visual

A interface agora consulta a conta efetiva do `gh`, exibe estados de sessão e permite verificar novamente. Logo própria e ícones desktop foram integrados; a barra superior usa overlay com controles nativos no macOS e controles próprios nos demais sistemas. O rodapé também recebeu a paleta verde.

Nesta atualização passaram 6 testes frontend, 5 testes Rust, 10 cenários Playwright e o build Tauri macOS. Detalhes, origem da logo e prompt em [brand.md](brand.md). A personalização dos controles nativos ainda requer validação interativa por plataforma.

## Atualização: SQLite

Persistência migrada para `lince.sqlite3`, com SQLite incorporado via rusqlite. Passaram os cinco testes de storage (migração única e backup, corrupção/schema futuro, rollback, roundtrip e preservação de outras PRs), totalizando 9 testes Rust sem rede. Clippy com `-D warnings` e build desktop macOS também passaram. Os testes usam bancos temporários: a importação do progresso real ocorre na próxima inicialização do aplicativo atualizado. A observação histórica sobre gravação atômica de JSON acima descreve a implementação anterior; a atual usa transações SQLite/WAL. Veja [storage.md](storage.md).


## Catálogo, filtros e updater (2026-09-16)

- Node 24 LTS: build de produção e 9 testes unitários passaram.
- Rust: 13 testes passaram; 2 testes de rede ficam ignorados por padrão. Clippy sem warnings.
- Chromium + WebKit: 18 cenários passaram, incluindo seleção pesquisável com avatar, autor da PR, codebases, paginação, retorno à home e atualização com falha/retry via IPC simulado.
- Workflow de release configurado para Wylp/Lince; valida versões e presença de quatro plataformas no latest.json antes da publicação manual do draft.
- Ainda pendentes: execução do CI Windows/Linux, assinatura de distribuição Apple/Microsoft e instalação real de uma atualização entre duas releases publicadas. O teste de updater simulado não valida a instalação nativa nem a assinatura de um artefato real.

## Histórico, alertas e snapshot em lote (2026-09-17)

- 22 testes de navegação passaram em Chromium/WebKit: histórico vazio, persistência, filtro, retomada, falha/retry; alertas por repo, permissão negada, persistência e falha de polling.
- 18 testes Rust passaram (mais 2 testes de rede ignorados por padrão), incluindo migração do schema 2 para 3, isolamento de escolhas por conta, contagem do histórico, agrupamento de blobs, limites e detecção de novas PRs. Clippy sem warnings.
- Os 9 testes unitários frontend passaram e o build web foi concluído.
- Teste real read-only com `cli/cli#14462`: dois arquivos carregados via árvores e lote GraphQL; diffs disponíveis no snapshot. Nenhum checkout alterado.
- Ainda não foi validada a entrega visual das notificações nativas nas três plataformas; os testes de interface usam IPC/permissões simulados. Windows/Linux e o pipeline de release permanecem sujeitos ao CI e à validação dos builds instalados.
