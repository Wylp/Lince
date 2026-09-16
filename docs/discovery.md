# Lista de PRs e codebases

**Listar PRs** abre o catálogo da conta autenticada no `gh`. A URL continua disponível para abertura direta. Os filtros permitem escolher autor da PR, repositório, linguagem e serviço/codebase, além de buscar nomes de repositório.

## Repositórios e PRs

- O catálogo usa `GET /user/repos?affiliation=owner,collaborator,organization_member`, paginado em lotes de 100, respeitando o acesso da conta. Repositórios arquivados/desabilitados são omitidos. Não listamos repositórios públicos aleatórios nem apenas PRs de autoria do usuário.
- O catálogo carrega progressivamente. Erros deixam uma indicação explícita de catálogo parcial e opção de retry. Há um teto defensivo de 1.000 páginas, também sinalizado.
- PRs são agrupadas por repositório. Até seis grupos são exibidos inicialmente; “Carregar mais repositórios” amplia a lista.
- Cada grupo consulta PRs abertas, ordenadas pela data de criação (mais novas primeiro), dez por página. “Carregar mais PRs” busca a próxima página. PRs draft são identificadas.
- Até três consultas de descoberta são executadas simultaneamente. Trabalho ainda não iniciado é descartado quando sua tela/componente é abandonado; respostas antigas não substituem resultados atuais.
- Botão Atualizar refaz o catálogo e as listas. Não há polling contínuo.
- Avatares de autores, owners e conta conectada usam `https://github.com/{login}.png?size=...`; carregamento lazy, sem referrer, fallback para iniciais em falha. A CSP permite apenas GitHub e seu host de avatares, além de assets locais.

## Prioridade dos repositórios

O histórico é **local ao Lince**, não o histórico de reviews enviadas no GitHub. Um novo arquivo marcado como revisado registra atividade; abrir uma PR ou rolar não aumenta a frequência. A unidade é uma PR por dia UTC: revisar 50 arquivos da mesma PR no mesmo dia continua sendo uma sessão.

A pontuação soma `1 / (1 + idade_em_dias / 7)` por sessão. Isso favorece frequência recente; empates usam a última revisão e depois o nome do repo. A mesma ordem aparece na lista e no filtro de repositórios. A atividade é gravada na mesma transação do progresso, antes da abertura do catálogo.

O schema SQLite 2 adiciona `review_activity`, `repository_config` e `codebases`. Progresso já existente é preservado. PRs anteriormente revisadas entram com peso mínimo e sem data inventada, exibidas como “Já revisado”; novas revisões passam a ter timestamps. Configurações e histórico persistem após reiniciar. O histórico atual é por dispositivo, como o progresso existente; não há sincronização nem separação por conta GitHub.

## Monorepos

No cabeçalho do repo, clique em **Codebases**, marque “Este repositório é um monorepo” e configure, por exemplo:

```text
apps/api = API
apps/web = Web
packages/auth = Autenticação
```

Caminhos são relativos à raiz, incluem subpastas e respeitam limites de diretório: `apps/api` não corresponde a `apps/api-other`. Vários caminhos podem ter o mesmo nome para compor um serviço. Caminhos sobrepostos podem produzir mais de uma label, intencionalmente.

As labels são locais: não criamos labels nem modificamos PRs no GitHub. Para cada PR de um monorepo visível, o backend consulta metadados, pagina todos os arquivos alterados e compara os SHAs antes/depois. Arquivos renomeados consideram os dois caminhos. Arquivos fora dos caminhos configurados geram **Fora das codebases**. Configuração vazia não pode ser habilitada pela interface.

A classificação não lê o conteúdo dos arquivos e também funciona para alterações binárias. PRs acima de 3.000 arquivos, lista incompleta, push concorrente ou falta de acesso exibem **Serviços não identificados**, com retry e motivo no tooltip. Enquanto carrega, a UI exibe “Identificando serviços…”. Ausência de resultado nunca significa ausência de serviços afetados.

O filtro por serviço se aplica às **PRs já carregadas** em cada grupo; isso está indicado na tela. Para pesquisar PRs mais antigas, carregue as próximas páginas. Ele não é uma busca global por paths em todo o histórico do GitHub. Não há inferência automática de pastas como serviços: os caminhos são explicitamente configurados pelo usuário.

## Validação

Testes Rust cobrem nomes seguros de repositórios, correspondência de caminhos, vários serviços, migração do schema 1, persistência de configuração e contagem de atividade sem inflação por scroll. Vitest cobre ranking, parsing de configuração e fila cancelável de três consultas. Playwright cobre catálogo paginado, prioridade, filtro de serviço/autor, paginação de PRs, abertura, configuração persistida e falhas parciais em Chromium e WebKit.

Teste real de leitura, opcional:

```sh
cargo test --manifest-path src-tauri/Cargo.toml live_discovery -- --ignored --nocapture
```

Consulta o catálogo autenticado (sem imprimir nomes de repos privados) e PRs públicas de `cli/cli`, incluindo classificação por arquivos. Depende de rede, autenticação e das PRs disponíveis no momento.

Os selects têm busca, navegação por teclado e avatares. Autor da PR consulta a busca de issues/PRs do GitHub com `author:login`; permite digitar um login ainda não listado. Resultados incompletos e o limite de 1.000 PRs por autor/repositório são sinalizados. As sugestões de autores vêm das PRs carregadas. A logo superior retorna à home depois de persistir o progresso.
