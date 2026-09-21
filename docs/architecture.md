# Decisões da primeira implementação

## Editor e fonte de verdade

A renderização atual usa Monaco Editor, com diff e código somente leitura, sintaxe, abas, explorador do repositório e navegação semântica JS/TS. A avaliação anterior de `react-diff-view` foi preservada nos testes de desenvolvimento. Veja [workspace de código](code-workspace.md) para a decisão, atalhos e limitações.

1. Rust valida uma URL HTTPS em github.com, consulta metadados e fixa `base.sha` e `head.sha`.
2. Compare obtém a base comum. O diff acumulado é **merge-base → head**.
3. `/pulls/N/files` é paginado em lotes de 100 e conferido com `changed_files`. PRs com mais de 3.000 arquivos são recusadas.
4. Metadados são relidos após a paginação; alteração de SHAs ou quantidade exige nova abertura.
5. Um cache Git bare próprio busca commits ausentes, sem checkout. Árvores e blobs locais são lidos por SHA, com conteúdo deduplicado em lote. Renomeações usam o caminho anterior na base.
6. **Patches da API são ignorados**: o Rust calcula patches completos sobre os blobs. A integridade e os limites são verificados antes de liberar o snapshot.

A autenticação permanece com o gh. A WebView recebe apenas comandos IPC específicos, sem acesso genérico a shell ou filesystem. Workers do editor são assets locais. Nenhum código do repositório é executado. A única escrita remota deste fluxo é a revisão em lote explicitamente publicada em Aplicar tudo; o backend valida intervalos, lados e SHAs antes do envio. Rascunhos ficam somente no SQLite até essa ação.

Veja [carregamento em lote](batch-loading.md) e [comentários e cache](code-workspace.md).

## Progresso

`lince.sqlite3` no `app_data_dir()` do Tauri, schema SQLite versionado com `PRAGMA user_version`. Guarda URL recente, seleção e, por repo/PR/arquivo: versão, revisado, scroll vertical e horizontal. O progresso não é enviado ao GitHub. Comentários publicados são uma operação separada.

A versão inclui base comum, **head SHA**, blob SHA, status e caminhos. A invalidação inicial é conservadora: qualquer novo head invalida todas as marcações e posições da PR, inclusive arquivos inalterados. Isso impede manter uma marcação diante de mudanças apenas de permissão. Preservar arquivos idênticos entre pushes exige comparar os dois lados e modos; fica como refinamento.

Writes são serializados na interface e no backend. Scroll salva após 300 ms de inatividade; seleção e revisão disparam gravação imediatamente. A posição em memória muda sem renderizar novamente as linhas a cada evento de scroll. Ao perder foco ou fechar a janela, a fila é drenada; uma falha ao salvar impede o fechamento pela janela para permitir retry. Encerramento forçado do processo pode perder eventos ainda não gravados.

SQLite é incorporado ao binário pelo `rusqlite` com feature `bundled`; o usuário não precisa instalar um servidor nem uma biblioteca SQLite separada. As tabelas são `app_state` (última URL), `reviews` (PR e seleção) e `file_progress` (caminho, versão, revisado e posições). Chaves estrangeiras, queries parametrizadas e constraints protegem o modelo.

Gravações usam transação `IMMEDIATE`, journal WAL, `synchronous=FULL` e espera de até 5 segundos por locks. Atualiza-se somente a PR salva; upserts evitam regravar linhas de arquivos que não mudaram. Caminhos removidos são eliminados da revisão na mesma transação. Leituras usam uma transação para retornar um snapshot coerente. O IPC continua tipado; os tokens e os diffs não são armazenados no banco.

Na primeira abertura, criação do schema e importação do `progress.json` existente acontecem na mesma transação. Após commit, o schema versionado impede reimportação. O JSON permanece intacto como backup, mas deixa de receber gravações. JSON inválido, banco corrompido ou schema mais novo geram erro; não há reset automático. Erros no meio da migração ou gravação fazem rollback.

O banco protege a integridade de escritores concorrentes, mas duas instâncias revisando a mesma PR podem sobrescrever o estado lógico uma da outra (última gravação vence). Continue usando uma instância por vez. Veja [storage.md](storage.md) para localização e testes.

## Desempenho e limites explícitos

Só o editor ativo é montado; modelos de código e índice permanecem em memória. Os limites de arquivos, memória, índice e subprocessos estão em [batch-loading.md](batch-loading.md). Código também é mantido no cache Git em disco, separado do SQLite, sem política automática de remoção nesta versão.

Conteúdo privado usa as permissões do gh. Expiração, rate limit, SSO e falta de acesso aparecem como erros. Arquivos binários, LFS, links, submódulos e conteúdo acima dos limites não podem ser marcados como revisados. Arquivos vazios e renomeações sem alteração textual podem ser revisados após consulta dos objetos e modos.

## Descoberta de gh

`LINCE_GH` (caminho absoluto definido pelo usuário), depois `PATH`, depois locais comuns: Homebrew em Apple Silicon/Intel, `/usr/bin`, `ProgramFiles/GitHub CLI` e `LOCALAPPDATA/Programs/GitHub CLI`. Não abrimos shell de login e não lemos tokens. Instalações fora desses locais devem usar `LINCE_GH` ou iniciar o app num terminal cujo PATH encontre `gh`.

## Progresso de carregamento

`open_pr` recebe um `Channel<LoadingProgress>` do Tauri, exclusivo da chamada. O backend informa as etapas reais `github`, `base`, `head`, `tree` e `diff`; durante o cálculo, relata a quantidade de arquivos preparados a cada 25 arquivos. Hits de cache informam a reutilização da revisão. A etapa inicial de salvar progresso ocorre no frontend antes da consulta. O canal não altera autenticação, cache nem checkout.

A interface ignora etapas atrasadas e mensagens recebidas após encerrar a chamada. Não há porcentagem ou avanço por temporizador: o relógio indica somente o tempo decorrido. Preparação do editor tem etapas próprias de recebimento dos dados e inicialização; histórico, catálogo, PRs, arquivo de contexto e prévia de definição usam mensagens específicas. Erros encerram o loading e preservam os fluxos existentes de tentativa. A prévia ignora respostas de uma consulta anterior quando o usuário navega para outro arquivo.
