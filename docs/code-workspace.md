# Revisão como navegação de código

O workspace usa **Monaco Editor 0.56**, editor do VS Code, para diff lado a lado, arquivo completo, destaque por linguagem e navegação. Todos os editores e previews são somente leitura (`readOnly`, `domReadOnly`, `originalEditable: false`). Não há comandos para salvar arquivos do projeto.

## Navegação

- A árvore começa recolhida numa faixa de 40 px. Hover, foco por teclado ou clique em **Mostrar arquivos** abre o painel sobre o código; **Fixar explorador** reserva espaço permanente. Escape recolhe o painel temporário e devolve foco ao editor.
- **Alterações** mostra os arquivos da PR; **Explorador** inclui os arquivos não alterados, no head ou na base comum.
- Abas (até 12), histórico voltar/avançar, **Cmd/Ctrl+P** para localizar arquivos.
- **Cmd/Ctrl+click** ou **F12** abre a definição; **Alt+F12** / Preview mostra a definição em um diálogo. Referências usa o serviço de linguagem do TypeScript.
- Arquivo completo e diff compartilham o snapshot. A origem base/head permanece identificada e a navegação no lado antigo usa a base.
- Posição dos diffs alterados, seleção e marcações persistem em SQLite. Rascunhos de comentários também persistem no SQLite após salvar. Abas, posições de arquivos de contexto, filtros e texto ainda não salvo do formulário ficam em memória.

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

### JS/TS por demanda

A abertura da PR não indexa mais os primeiros 2.000 arquivos nem carrega 16 MiB de JS/TS dos dois lados. Os diffs alterados continuam completos e preparados em lote. Ao pedir uma definição, preview, hover ou referências, o worker TypeScript identifica imports, re-exports, `require` e referências de arquivo do documento consultado. As dependências transitivas são resolvidas com o próprio resolvedor TypeScript, usando a árvore do snapshot, e lidas em lotes do Git local. Ciclos são visitados uma única vez. Arquivos de outros serviços que não fazem parte desse grafo não são carregados.

A configuração lê `baseUrl` e `paths` diretamente do `tsconfig.json`/`jsconfig.json` mais próximo, sob demanda. Ainda não resolve `extends`, project references, pacotes de workspace ou dependências externas que precisem de instalação. Scripts globais sem imports e referências em consumidores ainda não carregados não são indexados automaticamente: a busca de referências considera o grafo carregado, não promete todas as referências do repositório.

Base e head têm grafos separados; a base só é analisada quando consultada. Até 12 grafos de caminhos são reaproveitados durante a sessão. Modelos fora do grafo atual são liberados quando não estão ligados a um editor/preview visível. O diff aberto continua intacto, incluindo posição e seleção. O worker restringe os arquivos participantes da análise ao grafo ativo.

Há um orçamento de proteção por consulta: 32 MiB de dependências, 10.000 caminhos, verificação de tempo de 15 s entre lotes e os limites textuais existentes por arquivo. Se atingido, o aviso explica que as **dependências daquele arquivo** ficaram parciais; o tamanho total do repositório por si só não causa aviso. O limite não é garantia de duração máxima do worker. A versão do Monaco está fixada no lockfile; seu worker foi estendido localmente para reutilizar o parser e o resolvedor já incorporados.

### Ícones

As árvores Alterações e Explorador usam SVGs locais do **Material Icon Theme 5.38.1**, com ícones por extensão/nome e pastas abertas/fechadas. Testes, workflows, GitHub, SQL e Docker têm ícones específicos. Estado de revisão permanece separado do tipo de arquivo. Origem e licença MIT estão em `src/assets/material/`. Não há CDN ou fonte de ícones remota.

## Estado dos arquivos e pastas

Nas árvores **Alterações** e **Explorador**, clique com o botão direito (ou Shift+F10) para marcar como visto ou voltar a pendente. Nas pastas, a ação inclui arquivos alterados nas subpastas e independe do filtro visual. Somente diffs disponíveis podem ser marcados como vistos; arquivos sem diff permanecem pendentes.

Para arquivos individuais, **Aprovado sem ler** registra uma decisão local distinta, inclusive quando o diff não pode ser exibido. O indicador âmbar `≈✓` diferencia esse estado do `✓` de visto. Nenhuma dessas ações envia uma aprovação ao GitHub. O filtro de pendentes e o progresso total consideram ambas as decisões, mantendo suas contagens separadas no cabeçalho e no histórico.

Pastas recebem `✓` quando todos os arquivos alterados descendentes estão vistos. Se todas as decisões foram tomadas, mas há arquivos aprovados sem leitura, recebem `≈✓` e a descrição “Pasta concluída com arquivos não lidos”. Pastas parciais mostram concluídos/total. Arquivos de contexto não alterados não entram nessa contagem nem recebem estado de revisão. Um novo snapshot que modifica a versão do arquivo invalida tanto a leitura quanto a aprovação sem ler.

## Cache Git separado

O Rust mantém repositórios **bare** em `app_cache_dir()/repositories/<hash-do-repo>.git`. A autenticação HTTPS usa `gh auth git-credential`. `LINCE_GIT` permite indicar o executável Git; por padrão ele precisa estar no PATH. `LINCE_GH` continua disponível.

O cache busca apenas os commits necessários com profundidade 1, sem checkout, histórico completo ou submódulos. Isso baixa as árvores completas desses commits, inclusive arquivos fora da PR. A primeira abertura pode baixar bastante conteúdo. Não executamos código, hooks ou instalação de dependências do projeto. O checkout do usuário não é consultado nem alterado.

**Atualizar PR** consulta os novos SHAs e busca os objetos ausentes. O snapshot em uso é imutável: um push não troca o código durante a leitura. Depois de aberto, navegar não faz requisições de arquivos ao GitHub; usa memória ou `git cat-file` local. Reabrir o mesmo snapshot reutiliza objetos já baixados.

Código, inclusive de repositórios privados, **permanece no cache em disco**. Ainda não há limite global de disco nem coleta automática dos snapshots antigos. Para remover o cache, feche o Lince e remova a subpasta `repositories` de `app_cache_dir()`; isso não remove o progresso SQLite em `app_data_dir()`. Uma próxima abertura baixa os objetos novamente. São locais diferentes: [persistência de estado](storage.md).

## Comentários

Passe o mouse sobre uma linha para revelar o **+**, clique nele ou arraste pela margem/números para selecionar várias linhas. Ao soltar, o formulário abre dentro do diff, abaixo da última linha selecionada, mantendo o intervalo destacado. Também é possível selecionar texto e usar o menu de contexto ou Cmd/Ctrl+Alt+M. Funciona na base e no head; o arraste fica limitado ao mesmo hunk e lado do diff. Esc ou Cancelar fecha o formulário.

**Salvar rascunho** grava o comentário no SQLite sem fazer escrita no GitHub. Em **Comentários (N)**, confira, edite ou remova os rascunhos. Somente **Aplicar tudo (N)** publica todos de uma vez como uma revisão `COMMENT`, sem aprovar nem solicitar alterações. Texto no formulário ainda não salvo não persiste ao fechar. Limites locais: 50 comentários por lote, 256 KiB de texto total e 16.000 caracteres por formulário.

O backend valida os intervalos e verifica base/head antes do envio. Se a PR mudar, os rascunhos antigos permanecem disponíveis para consulta e cópia, mas não são transferidos automaticamente para outras linhas. Descarte o lote antigo antes de começar na nova versão.

O lote é congelado em disco antes do POST. Em uma falha de transporte ou encerramento durante o envio, **Verificar envio** procura o identificador do lote nas revisões da PR, sem republicar. Se o GitHub já recebeu a revisão, os rascunhos são concluídos localmente. Liberar nova tentativa exige conferir a PR e confirmar explicitamente que o lote não foi publicado; não há reenvio automático. SQLite e GitHub não compartilham uma transação, portanto essa reconciliação também cobre falhas entre publicação e gravação local.

Arquivos de contexto não alterados não aceitam comentários de diff. Aprovação, sugestões editáveis e leitura/resposta de threads existentes ainda não foram implementadas.

## Escolha e custo do editor

A primeira versão avaliou `react-diff-view`: adequada a patches, mas sem um serviço de linguagem ou editor virtualizado. Monaco substitui essa renderização e evita construir navegação semântica própria. A biblioteca anterior permanece apenas como dependência de desenvolvimento para os testes históricos de parsing de patches.

Monaco é carregado por importação dinâmica ao entrar no workspace. Workers e linguagens são assets locais, sem CDN. O custo é maior: aproximadamente 3,95 MB do módulo do editor e 7,03 MB do worker TypeScript antes de gzip. A home permanece em outro módulo (~278 kB). O Vite emite aviso de chunk grande; os testes de produção cobrem o carregamento dos workers. Ainda falta benchmark com grandes monorepos e validação nativa Windows/Linux.

Referências: [Monaco](https://github.com/microsoft/monaco-editor), [API Monaco](https://microsoft.github.io/monaco-editor/docs.html), [git fetch](https://git-scm.com/docs/git-fetch), [git cat-file](https://git-scm.com/docs/git-cat-file), [revisões GitHub](https://docs.github.com/en/rest/pulls/reviews#create-a-review-for-a-pull-request).

Parsers: [Tree-sitter e bindings Rust](https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_rust/README.md). Gramáticas oficiais são dependências fixadas no `Cargo.lock`.

## Decisões por arquivo e modo foco

O cabeçalho e o clique direito oferecem Concordo, Discordo e Não li. Pastas aplicam a decisão aos arquivos alterados descendentes, mesmo ocultos por filtros; Concordo/Discordo se limitam aos diffs disponíveis. O resumo distingue leitura, discordância e ausência de leitura. Nada é enviado ao GitHub por essas ações.

Em Configurações, o modo foco (desativado inicialmente) inicia no primeiro arquivo pendente e bloqueia a troca manual de arquivos, o histórico de navegação, a busca e as ações em lote. Cada decisão salva abre o próximo pendente; falhas de gravação mantêm o arquivo atual. Um comentário em edição precisa ser salvo ou cancelado antes de decidir. Prévias de definições continuam disponíveis e o botão Sair do modo foco libera a navegação. A preferência persiste no SQLite; o app continua iniciando na home com URL vazia.

Validação desta mudança: testes de navegador em Chromium/WebKit, testes unitários do modelo, migração SQLite 5→6 e build nativa macOS. Windows/Linux ainda dependem de validação nativa nesses sistemas.

## Tipos e revisão dos usos

A análise de JS/TS reutiliza o TypeChecker do worker Monaco/TypeScript. Ao abrir um arquivo, carrega seu grafo de dependências sob demanda e identifica até 200 declarações de variáveis, parâmetros ou propriedades com uniões entre categorias (string, objeto, número, booleano, null/undefined). Uniões de literais da mesma categoria não geram aviso. Avisos informativos aparecem no editor somente leitura e no botão Tipos. Não são diagnósticos de bug: uma união pode ser intencional. `any`, dependências indisponíveis e valores de execução limitam a detecção; strictNullChecks é habilitado para a análise, independentemente do projeto. Não instala pacotes nem executa código da PR.

Usos e revisão consulta referências semânticas do símbolo sob o cursor, excluindo sua declaração. A busca lê JS/TS do mesmo snapshot/base ou head, em lotes locais de oito arquivos, apenas quando solicitada. Respeita os limites de 1 MiB por arquivo, 5.000 arquivos, 32 MiB e 20 segundos de leitura; mostra quantidade lida/total. Fechar o painel cancela os próximos lotes. Usa a configuração do arquivo de origem: monorepos com múltiplos tsconfigs, dependências ausentes, usos dinâmicos e outras linguagens podem ter referências omitidas, mesmo quando todos os arquivos foram lidos. Não afirma cobertura completa.

Os resultados mostram revisão por arquivo, não por ocorrência. Concordo/Discordo contam como leitura, mas discordâncias continuam explícitas. Não li e Aprovado sem ler não contam como leitura. Arquivos fora do diff não são considerados revisados; ocorrências na base não herdam estado do head. No modo foco, o painel pode ser consultado, mas a navegação para outro arquivo continua bloqueada.

Essa análise semântica inicialmente suporta JS/TS; as oito outras linguagens continuam com navegação por candidatos sintáticos, sem inferência de tipos ou rastreamento confiável de usos.

## Markdown nos comentários

O editor inline oferece Escrever/Prévia, formatação da seleção, listas, citações, links, imagens por URL, tabelas, menções, referências e blocos de sugestão. Cmd/Ctrl+B/I/K formata; Cmd/Ctrl+Z desfaz e Shift+Cmd/Ctrl+Z refaz nesta sessão de edição. O texto original é salvo e publicado sem transformação. A lista de rascunhos também renderiza o Markdown.

A prévia é local com [react-markdown](https://github.com/remarkjs/react-markdown), [remark-gfm](https://github.com/remarkjs/remark-gfm) e remark-breaks. GFM cobre tabelas, tarefas, tachado, autolinks e notas de rodapé; quebras simples são exibidas como nos comentários. HTML cru é ignorado; scripts e URLs de execução não são habilitados. A prévia não reproduz todos os recursos hospedados do GitHub: menções/issues não têm autocomplete ou expansão automática, sugestões são blocos de texto, anexos locais não têm upload, e recursos como Mermaid e alertas especiais não são renderizados como no GitHub. Imagens podem usar URLs já hospedadas. A edição e a prévia nunca enviam comentários; a publicação continua restrita a Aplicar tudo.
