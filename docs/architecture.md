# Decisões da primeira implementação

## Biblioteca de diff

Foi avaliada e adotada **react-diff-view 3** ([documentação e código](https://github.com/otakustay/react-diff-view)). Ela consome patches unificados, oferece visão split, gutters e identificadores de linhas, decorações por hunk e extensões para comentários e tokens. Há testes locais com inclusão, remoção, modificação/renomeação e ausência de newline final. Os testes de navegação rodam em Chromium e WebKit.

Não foi criado um renderizador de linhas próprio. O Rust usa `similar` para calcular um patch completo; o React delega o parsing e as linhas à biblioteca. Cabeçalhos internos usam nomes sintéticos; os caminhos reais e renomeações aparecem no cabeçalho fixo. Isso evita ambiguidade com espaços, tabs e caracteres especiais em nomes Git. Mudanças de modo Git e ausência de newline final são mostradas explicitamente.

Limites da avaliação: sem virtualização, syntax highlighting ainda desligado, sem testes com leitor de tela ou WebViews nativas de Linux/Windows. Tabelas, botões, inputs, labels, foco visível e navegação por Tab funcionam nos testes dos browsers. Uma única árvore de diretórios com `details/summary` evita simular parcialmente o complexo padrão ARIA tree. Se a demanda superar os limites de renderização, avaliar virtualização antes de ampliá-los.

## Fonte de verdade e integridade

1. Rust valida uma URL HTTPS em github.com, consulta metadados da PR e fixa `base.sha` e `head.sha`.
2. A API Compare obtém a base comum desses SHAs. O diff é **merge-base → head**, incluindo todas as mudanças acumuladas da PR.
3. `/pulls/N/files` é paginado em lotes de 100. A API limita a listagem a 3.000 arquivos: PRs maiores são recusadas explicitamente. A quantidade é conferida com `changed_files`.
4. Metadados são relidos após a paginação. Se base/head ou quantidade não batem, a operação falha e pede nova abertura. A listagem da PR não tem parâmetro SHA; essa verificação detecta mudanças durante a coleta.
5. As duas árvores Git recursivas fixam modos, tamanhos e SHAs; blobs dos arquivos alterados são buscados em lotes GraphQL e deduplicados. Todo o snapshot é preparado antes da revisão. Renomeações usam o caminho anterior. Veja [carregamento em lote](batch-loading.md).
6. **Patches da API são ignorados**, não usados como fallback: podem estar ausentes ou truncados. Se uma árvore estiver truncada, o lote não é aberto. Falhas de consulta são exibidas e permitem retry.

Não há `git checkout`, `git fetch`, escrita no repositório nem download de repositório. O processo `gh api --hostname github.com` (GET REST / POST GraphQL somente com queries de leitura) recebe argumentos separados, sem shell. Tokens permanecem com o `gh`; o frontend recebe apenas dados de revisão. São permitidos somente comandos próprios via IPC, sem shell ou filesystem genéricos na WebView. CSP bloqueia scripts remotos.

Referências: [GitHub Pull Requests REST](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files), [Compare](https://docs.github.com/en/rest/commits/commits#compare-two-commits), [Git Trees](https://docs.github.com/en/rest/git/trees), [Git blobs](https://docs.github.com/en/rest/git/blobs).

## Progresso

`lince.sqlite3` no `app_data_dir()` do Tauri, schema SQLite versionado com `PRAGMA user_version`. Guarda URL recente, seleção e, por repo/PR/arquivo: versão, revisado, scroll vertical e horizontal. Nada é enviado ao GitHub.

A versão inclui base comum, **head SHA**, blob SHA, status e caminhos. A invalidação inicial é conservadora: qualquer novo head invalida todas as marcações e posições da PR, inclusive arquivos inalterados. Isso impede manter uma marcação diante de mudanças apenas de permissão. Preservar arquivos idênticos entre pushes exige comparar os dois lados e modos; fica como refinamento.

Writes são serializados na interface e no backend. Scroll salva após 300 ms de inatividade; seleção e revisão disparam gravação imediatamente. A posição em memória muda sem renderizar novamente as linhas a cada evento de scroll. Ao perder foco ou fechar a janela, a fila é drenada; uma falha ao salvar impede o fechamento pela janela para permitir retry. Encerramento forçado do processo pode perder eventos ainda não gravados.

SQLite é incorporado ao binário pelo `rusqlite` com feature `bundled`; o usuário não precisa instalar um servidor nem uma biblioteca SQLite separada. As tabelas são `app_state` (última URL), `reviews` (PR e seleção) e `file_progress` (caminho, versão, revisado e posições). Chaves estrangeiras, queries parametrizadas e constraints protegem o modelo.

Gravações usam transação `IMMEDIATE`, journal WAL, `synchronous=FULL` e espera de até 5 segundos por locks. Atualiza-se somente a PR salva; upserts evitam regravar linhas de arquivos que não mudaram. Caminhos removidos são eliminados da revisão na mesma transação. Leituras usam uma transação para retornar um snapshot coerente. O IPC continua tipado; os tokens e os diffs não são armazenados no banco.

Na primeira abertura, criação do schema e importação do `progress.json` existente acontecem na mesma transação. Após commit, o schema versionado impede reimportação. O JSON permanece intacto como backup, mas deixa de receber gravações. JSON inválido, banco corrompido ou schema mais novo geram erro; não há reset automático. Erros no meio da migração ou gravação fazem rollback.

O banco protege a integridade de escritores concorrentes, mas duas instâncias revisando a mesma PR podem sobrescrever o estado lógico uma da outra (última gravação vence). Continue usando uma instância por vez. Veja [storage.md](storage.md) para localização e testes.

## Desempenho e limites explícitos

- Só o diff selecionado é montado; árvore e diff têm scroll separado.
- Até três consultas de arquivos concorrentes. Respostas antigas nunca substituem a seleção atual.
- Cache em memória: 20 diffs no frontend e um snapshot completo no Rust (32 MiB de blobs únicos e 32 MiB de patches). Nenhum conteúdo de código é persistido pelo Lince.
- Cada execução `gh` tem timeout de 60 s e limite de saída de 32 MiB; geração do diff tem deadline de 3 s (`similar` pode usar uma solução menos mínima, mas completa).
- Conteúdo máximo: 1 MiB por lado, 12.000 linhas por arquivo, 4.000 bytes por linha, 16.000 linhas no patch gerado. Exceder qualquer limite bloqueia a revisão daquele arquivo; não mostramos um fragmento como se fosse completo.
- Binários com NUL, conteúdo não UTF-8, Git LFS, links simbólicos, submódulos e modos/status desconhecidos ficam explicitamente indisponíveis. Não inferimos que ausência de patch significa arquivo vazio.
- Arquivos vazios e renomeações sem alteração textual podem ser revisados após os conteúdos e modos serem consultados.
- Sem expansão de contexto, diff de imagens ou navegação por abas nesta entrega.
- Conteúdo privado funciona com as permissões da conta `gh`; expiração de token, rate limit, SSO e falta de acesso aparecem como erros de consulta.

## Descoberta de gh

`LINCE_GH` (caminho absoluto definido pelo usuário), depois `PATH`, depois locais comuns: Homebrew em Apple Silicon/Intel, `/usr/bin`, `ProgramFiles/GitHub CLI` e `LOCALAPPDATA/Programs/GitHub CLI`. Não abrimos shell de login e não lemos tokens. Instalações fora desses locais devem usar `LINCE_GH` ou iniciar o app num terminal cujo PATH encontre `gh`.
