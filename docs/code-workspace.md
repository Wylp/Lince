# Revisão como navegação de código

O workspace usa **Monaco Editor 0.56**, editor do VS Code, para diff lado a lado, arquivo completo, destaque por linguagem e navegação. Todos os editores e previews são somente leitura (`readOnly`, `domReadOnly`, `originalEditable: false`). Não há comandos para salvar arquivos do projeto.

## Navegação

- A árvore começa recolhida numa faixa de 40 px. Hover, foco por teclado ou clique em **Mostrar arquivos** abre o painel sobre o código; **Fixar explorador** reserva espaço permanente. Escape recolhe o painel temporário e devolve foco ao editor.
- **Alterações** mostra os arquivos da PR; **Explorador** inclui os arquivos não alterados, no head ou na base comum.
- Abas (até 12), histórico voltar/avançar, **Cmd/Ctrl+P** para localizar arquivos.
- **Cmd/Ctrl+click** ou **F12** abre a definição; **Alt+F12** / Preview mostra a definição em um diálogo. Referências usa o serviço de linguagem do TypeScript.
- Arquivo completo e diff compartilham o snapshot. A origem base/head permanece identificada e a navegação no lado antigo usa a base.
- Posição dos diffs alterados, seleção e marcações persistem em SQLite. Abas, posições de arquivos de contexto, filtros e rascunhos de comentário ficam em memória nesta versão.

### Dez linguagens para previews

| Linguagens | Resolução |
|---|---|
| JavaScript, TypeScript | Serviço semântico do TypeScript no Monaco: definições, referências e hover |
| Python, Java, C#, Go, Rust, C, C++, PHP | Parsers Tree-sitter incorporados ao binário: declarações candidatas, F12/Cmd+click e preview |

As dez foram escolhidas como cobertura inicial de linguagens comuns, não como um ranking estatístico. Não precisam de instalações adicionais de servidores de linguagem. C/C++ incluem headers; `.h` usa a gramática C++ quando aberto diretamente, e também entra no índice C.

Nas oito linguagens adicionais o app **analisa a estrutura sintática**, identifica a palavra sob o cursor e procura declarações de mesmo nome no índice daquela linguagem/lado. A UI informa que são candidatas; havendo nomes iguais, mostra opções. Declarações no mesmo arquivo vêm primeiro. Não é resolução semântica: aliases, imports renomeados, tipos dos receptores, sobrecargas, herança, macros expandidas e dependências externas não são resolvidos. Referências semânticas continuam exclusivas de JS/TS; o botão fica desabilitado nas demais. Comentários e strings não viram consultas de definição só por conter um nome.

O primeiro pedido lê um lote **local** de blobs daquela linguagem e lado. Análise roda em `spawn_blocking`, sem processos de compilação, execução de projeto ou escrita de worktree. Limites: 2.000 arquivos / 16 MiB por linguagem e lado, 20.000 declarações, 15 s por índice e 500 ms por parse. Diretórios gerados/dependências são excluídos; limites e erros de sintaxe geram aviso de índice parcial. Resultados são limitados a 20 candidatas, com aviso quando truncados. Até seis índices ficam em memória, identificados por snapshot, lado e linguagem. Os arquivos dos destinos são lidos no cache Git, sem requests ao GitHub.

A cobertura inicial inclui funções/métodos e tipos/classes; não é uma busca completa de variáveis locais. Servidores LSP podem ampliar a precisão numa próxima etapa, com configuração e política explícita para projetos que executam ferramentas durante a análise.

### Mais espaço para leitura

A PR ocupa uma linha: título, identificação e progresso. Autor, branches e commits ficam em **Detalhes**. Controles e abas foram compactados; o código ocupa aproximadamente 70% da área de uma janela de 1440×940 com a árvore recolhida. Abrir o explorador temporariamente não redimensiona o diff. Imports JS/TS usam `originSelectionRange` para destacar o caminho inteiro, por exemplo `@/services/orders`, mantendo a resolução do destino no serviço TypeScript.

A configuração lê `baseUrl` e `paths` diretamente do `tsconfig.json`/`jsconfig.json` mais próximo. Ainda não resolve `extends`, project references, pacotes de workspace ou dependências externas que precisem de instalação. O índice inicial admite 2.000 documentos JS/TS/JSON e 16 MiB, somando base e head; acima disso mostra aviso de índice parcial. Arquivos restantes continuam acessíveis localmente pelo explorador. A resolução depende dos documentos disponíveis no índice.

## Cache Git separado

O Rust mantém repositórios **bare** em `app_cache_dir()/repositories/<hash-do-repo>.git`. A autenticação HTTPS usa `gh auth git-credential`. `LINCE_GIT` permite indicar o executável Git; por padrão ele precisa estar no PATH. `LINCE_GH` continua disponível.

O cache busca apenas os commits necessários com profundidade 1, sem checkout, histórico completo ou submódulos. Isso baixa as árvores completas desses commits, inclusive arquivos fora da PR. A primeira abertura pode baixar bastante conteúdo. Não executamos código, hooks ou instalação de dependências do projeto. O checkout do usuário não é consultado nem alterado.

**Atualizar PR** consulta os novos SHAs e busca os objetos ausentes. O snapshot em uso é imutável: um push não troca o código durante a leitura. Depois de aberto, navegar não faz requisições de arquivos ao GitHub; usa memória ou `git cat-file` local. Reabrir o mesmo snapshot reutiliza objetos já baixados.

Código, inclusive de repositórios privados, **permanece no cache em disco**. Ainda não há limite global de disco nem coleta automática dos snapshots antigos. Para remover o cache, feche o Lince e remova a subpasta `repositories` de `app_cache_dir()`; isso não remove o progresso SQLite em `app_data_dir()`. Uma próxima abertura baixa os objetos novamente. São locais diferentes: [persistência de estado](storage.md).

## Comentários

Selecione uma linha de um arquivo alterado e clique em **Comentar linha**. O formulário informa caminho, linha e lado; somente **Publicar no GitHub** cria um comentário de revisão. Cancelar não envia nada. O backend valida a linha contra os hunks completos, verifica se base/head ainda correspondem ao snapshot e envia o comentário associado ao commit revisado. Falha de envio preserva o texto no formulário; mudar de sessão ou fechar o app pode perder rascunhos não enviados.

Arquivos de contexto não alterados não aceitam comentários de diff. Aprovação, submissão de uma revisão em lote, sugestões editáveis e leitura/resposta de threads existentes ainda não foram implementadas.

## Escolha e custo do editor

A primeira versão avaliou `react-diff-view`: adequada a patches, mas sem um serviço de linguagem ou editor virtualizado. Monaco substitui essa renderização e evita construir navegação semântica própria. A biblioteca anterior permanece apenas como dependência de desenvolvimento para os testes históricos de parsing de patches.

Monaco é carregado por importação dinâmica ao entrar no workspace. Workers e linguagens são assets locais, sem CDN. O custo é maior: aproximadamente 3,95 MB do módulo do editor e 7,03 MB do worker TypeScript antes de gzip. A home permanece em outro módulo (~278 kB). O Vite emite aviso de chunk grande; os testes de produção cobrem o carregamento dos workers. Ainda falta benchmark com grandes monorepos e validação nativa Windows/Linux.

Referências: [Monaco](https://github.com/microsoft/monaco-editor), [API Monaco](https://microsoft.github.io/monaco-editor/docs.html), [git fetch](https://git-scm.com/docs/git-fetch), [git cat-file](https://git-scm.com/docs/git-cat-file), [comentários de revisão GitHub](https://docs.github.com/en/rest/pulls/comments#create-a-review-comment-for-a-pull-request).

Parsers: [Tree-sitter e bindings Rust](https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_rust/README.md). Gramáticas oficiais são dependências fixadas no `Cargo.lock`.
