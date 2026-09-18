# Lince

**Veja cada mudança. Mantenha o contexto.**

Lince é um aplicativo desktop open source para revisar pull requests do GitHub com foco em navegação, contexto e progresso. O nome remete à visão aguçada e à atenção aos detalhes do animal.

## Estado do projeto

Primeira versão funcional implementada com Tauri 2, React, TypeScript, Vite e Rust. Abre PRs do GitHub.com com a autenticação existente do `gh`, mostra árvore de arquivos e diff acumulado lado a lado, preserva a posição por arquivo e salva o progresso localmente.

A stack usa **Node 24 LTS** (`.nvmrc`, `mise.toml` e `engines`). Código e lockfiles estão nesta pasta; nenhum repositório remoto foi criado. Licença ainda a definir antes da publicação.

## Executar

Pré-requisitos: Node 24 LTS, Rust stable, Git, GitHub CLI autenticado e dependências nativas do Tauri. Com mise, execute `mise install` / `mise exec -- npm ci`; com nvm, `nvm install` / `nvm use`.

```sh
npm ci
gh auth status
# Se necessário: gh auth login --hostname github.com
npm run tauri dev
```

Cole uma URL `https://github.com/owner/repo/pull/123`. Selecione arquivos na árvore, use Anterior/Próximo e marque Revisado. O app reabre a última PR e restaura seleção, posição e progresso. Abrir novamente a URL atual atualiza o snapshot. Um novo push invalida o progresso de forma conservadora; veja [decisões técnicas](docs/architecture.md).

`npm run dev` abre somente o frontend para desenvolvimento: a integração com `gh` depende do aplicativo desktop. Não há modo de demonstração ativado em produção.

Pré-requisitos por plataforma:

- **macOS:** Xcode ou Command Line Tools, Rust e `gh`. Validado nesta máquina Apple Silicon.
- **Windows:** Visual Studio Build Tools com Desktop development with C++, Rust com toolchain MSVC e WebView2; instale `gh` e coloque-o no PATH.
- **Linux (Debian/Ubuntu):** `build-essential libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`, além de Rust e `gh`.

Consulte a [lista oficial do Tauri](https://tauri.app/start/prerequisites/) para sua distribuição. Caso o app não encontre `gh`, defina `LINCE_GH` com o caminho absoluto do executável. Não é preciso clonar o repositório da PR.

## Listar PRs e configurar monorepos

Clique em **Listar PRs** para navegar pelas PRs abertas dos repositórios em que sua conta participa. Filtre por autor da PR, repositório, linguagem ou serviço/codebase. A lista prioriza os repos mais revisados recentemente no Lince; cada grupo mostra suas PRs mais novas e permite carregar mais.

Para um monorepo, abra **Codebases** no cabeçalho do repo e mapeie caminhos como `apps/api = API` e `apps/web = Web`. As PRs recebem labels locais dos serviços afetados, incluindo renomeações e arquivos fora dos caminhos configurados. O filtro de serviço considera as PRs carregadas. [Funcionamento e limites](docs/discovery.md).

## Validar e compilar

```sh
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npx playwright install chromium webkit
npm run test:e2e
npm run tauri build -- --debug --no-bundle
```

O binário de desenvolvimento é gerado em `src-tauri/target/debug/` (`lince` ou `lince.exe`). Build de release: `npm run tauri build -- --no-bundle`. Instaladores, assinatura e publicação estão desativados.

Teste opcional de integração real, somente leitura, requer `gh` autenticado e rede:

```sh
cargo test --manifest-path src-tauri/Cargo.toml live_public_pr -- --ignored --nocapture
```

`LINCE_TEST_PR` permite escolher outra URL para esse teste. Veja [validação e limitações](docs/validation.md). Há CI configurada para compilar/testar em Linux, Windows e macOS; ela ainda precisa ser executada num repositório remoto.

## Limites desta entrega

PRs com mais de 3.000 arquivos não são abertas. Binários, LFS, submódulos, links simbólicos, conteúdo não UTF-8 e arquivos acima dos limites documentados ficam indisponíveis e não podem ser marcados como revisados. Patches truncados da API não são usados: o diff é calculado sobre blobs completos e SHAs fixos. Use uma única instância do Lince por vez.

As seções abaixo preservam o contexto e o direcionamento original do projeto. Detalhes da implementação atual estão em [architecture.md](docs/architecture.md).

## Problema

Revisar uma PR grande em uma página que concatena todos os diffs exige rolagem constante e faz o revisor perder referências. Uma árvore que apenas rola a página até um arquivo não resolve essa experiência.

O Lince deve permitir ler o diff acumulado da PR, escolher um arquivo e ver apenas aquele diff. O revisor precisa conseguir alternar entre arquivos relacionados, como controller, service e teste, mantendo a posição de leitura e sabendo o que falta revisar.

## Público e operação

- Ferramenta para ajudar no dia a dia de desenvolvedores.
- Código aberto no GitHub; quem quiser poderá obter o código e executar localmente.
- Suporte a Linux, Windows e macOS.
- Sem serviço hospedado, cadastro próprio, cobrança ou infraestrutura remota do Lince.
- Distribuição por lojas, instaladores assinados e atualização automática ficam fora do escopo inicial.
- Licença open source e criação do repositório remoto ainda precisam ser definidas.

## Stack decidida

- **Tauri 2**: estrutura do aplicativo desktop.
- **React + TypeScript**: interface.
- **Vite**: desenvolvimento e build do frontend.
- **Rust**: integração local e comandos do backend Tauri.
- **Git e GitHub CLI (`gh`)**: acesso ao repositório e ao GitHub, aproveitando a autenticação existente do desenvolvedor.

Não há necessidade inicial de servidor Node/Hono em execução: a interface conversa com comandos Rust pelo mecanismo de comunicação do Tauri. Node é uma ferramenta de desenvolvimento/build do frontend.

## Experiência central

1. Informar uma URL de PR do GitHub. A seleção de repositório local e PR por número pode ser adicionada depois.
2. Ver título, autor, branches, número da PR e resumo das alterações.
3. Navegar por uma árvore persistente com os arquivos alterados.
4. Abrir o diff acumulado de um arquivo por vez, inicialmente lado a lado.
5. Alternar entre arquivos mantendo posição de leitura e seleção.
6. Marcar arquivos como revisados e visualizar o progresso.
7. Retomar a revisão após fechar o aplicativo.

O layout deve reservar áreas independentes para a árvore e o diff, cada uma com sua própria rolagem. A identificação do arquivo selecionado e da PR deve continuar visível. Abas para arquivos relacionados são uma proposta para facilitar alternância.

## Primeira entrega: leitura e navegação

Uma primeira versão útil deve abrir uma PR real e oferecer:

- Integração com `gh` autenticado, incluindo repositórios privados aos quais o usuário tem acesso.
- Lista completa de arquivos alterados, tratando paginação.
- Diff completo da PR por arquivo, sem exigir revisão commit a commit.
- Árvore fixa, seleção clara e diff isolado.
- Posição de leitura preservada por arquivo.
- Marcação de revisado e progresso persistido localmente.
- Estados claros de carregamento, falha de autenticação, falta do `gh` e falta de acesso.
- Indicação explícita quando um diff não puder ser exibido, por exemplo para binários ou conteúdo truncado.

Comentários e envio de revisão não são necessários para validar essa primeira entrega.

## Evoluções após validar a experiência

1. Exibir discussões existentes e criar comentários nas linhas.
2. Preparar e enviar uma revisão com comentário, aprovação ou solicitação de alterações.
3. Mostrar o que mudou desde a última revisão e sinalizar arquivos alterados por novos pushes.
4. Aprimorar atalhos, busca, abas e filtros conforme o uso real.

Revisão automática por IA, suporte a outros provedores Git e edição de código não fazem parte do escopo inicial.

## Arquitetura proposta

O frontend controla navegação, abas, apresentação do diff e estados da interface. O backend Rust consulta o GitHub por meio do `gh`, executa operações Git quando necessário e persiste o estado local.

### Integração e dados

- Começar com GitHub.com; GitHub Enterprise é uma extensão futura.
- Usar comandos estruturados, com argumentos separados, evitando interpolar entrada do usuário em scripts de shell.
- Manter credenciais sob gestão do `gh`; não enviar tokens para o frontend nem salvá-los em arquivos de progresso.
- Executar consultas sem bloquear a interface e apresentar erros com contexto.
- Ler PRs sem alterar o checkout de trabalho do desenvolvedor. Se operações Git exigirem arquivos locais, avaliar um cache isolado.
- Consultar metadados e arquivos usando os commits da PR; definir uma estratégia para conteúdo e diffs grandes que não dependa exclusivamente de patches potencialmente truncados da API.

### Semântica do diff

O diff principal deve representar as alterações da PR em relação à base comum apropriada, como a visão de alterações do GitHub. Comparar simplesmente os dois últimos commits das branches pode incluir mudanças alheias à PR.

Fixar os SHAs da revisão carregada evita misturar conteúdo de momentos diferentes quando há um novo push. Considerar arquivos adicionados, removidos, renomeados, binários e arquivos sem newline final.

A primeira versão adotou `react-diff-view`, após avaliação de patches e navegação em Chromium/WebKit. Detalhes e limites da avaliação estão em [architecture.md](docs/architecture.md). Destaque de sintaxe e validação das três WebViews nativas continuam pendentes.

### Estado local

O progresso é persistido em SQLite (`lince.sqlite3`) no diretório de dados do aplicativo fornecido pelo Tauri, com transações. A seleção, posição de leitura e progresso ficam associados a repositório e PR. O `progress.json` das primeiras versões é importado automaticamente e preservado como backup. Veja [persistência](docs/storage.md).

A marcação de revisado precisa estar associada à versão do arquivo/diff. Um novo push não pode manter silenciosamente como revisado um arquivo cujo conteúdo mudou. Comparação entre rodadas pode vir depois, mas o modelo inicial deve prever essa invalidação.

## Compatibilidade

Tauri utiliza WebViews diferentes nos sistemas operacionais. Validar layout, rolagem, fontes, seleção de texto e desempenho em Linux, Windows e macOS.

Documentar os pré-requisitos de desenvolvimento por plataforma, incluindo Rust, Node, Git, `gh` e dependências nativas do Tauri. Não presumir que ter Node instalado seja suficiente para compilar o aplicativo.

Evitar caminhos e comandos específicos de Unix. Considerar descoberta do executável `gh` quando o app é iniciado fora do terminal. Testes em um único sistema não comprovam compatibilidade com os outros.

## Critérios de sucesso da primeira versão

- Uma PR com muitos arquivos pode ser revisada sem percorrer uma página com todos os diffs concatenados.
- Trocar entre dois arquivos e voltar preserva a posição de leitura.
- O revisor identifica o arquivo atual e os arquivos pendentes sem perder o contexto.
- Reabrir o aplicativo recupera o progresso da mesma revisão.
- Arquivos indisponíveis ou patches incompletos nunca aparecem como se estivessem integralmente revisados.
- O aplicativo não altera a branch nem os arquivos de trabalho do usuário para uma operação de leitura.

## Próximas validações

- Executar a matriz de CI e testar interação nas WebViews nativas de Linux e Windows.
- Ampliar amostras de PRs privadas e grandes, incluindo paginação real e acessibilidade com leitor de tela.
- Avaliar virtualização e destaque de sintaxe conforme a experiência de uso.
- Definir licença antes de publicar o projeto.

## Referências

- [Tauri: pré-requisitos por plataforma](https://tauri.app/start/prerequisites/)
- [Tauri: comunicação entre frontend e Rust](https://tauri.app/develop/calling-rust/)
- [GitHub CLI](https://cli.github.com/manual/)


## Atualizações automáticas

Releases em [Wylp/Lince](https://github.com/Wylp/Lince). O botão na barra superior oferece a nova versão e instala com assinatura verificada, preservando o progresso. Consulte [preparação e publicação](docs/updates.md) para configurar a chave de assinatura no GitHub Actions antes da primeira release.


## Histórico, alertas e carregamento em lote

**Histórico** mostra suas PRs salvas, progresso e última revisão, com busca e botão para retomar. Em **Listar PRs**, ative **Avisar novas PRs** nos repos desejados: o Lince consulta a cada dois minutos enquanto estiver aberto, inclusive minimizado. As escolhas e o cursor persistem no SQLite. [Detalhes e limites](docs/history-notifications.md).

A abertura agora prepara todos os conteúdos e diffs em lotes GraphQL. Navegar entre arquivos não consulta o GitHub. O snapshot inclui conteúdo antes/depois para reutilização por futuras features. [Arquitetura, custos e limites do lote](docs/batch-loading.md).
