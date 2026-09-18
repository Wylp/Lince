# Persistência local em SQLite

O Lince usa SQLite incorporado ao executável, via `rusqlite`/`bundled`. Não precisa instalar SQLite nem iniciar serviço.

## O que é persistido

| Tabela | Conteúdo |
|---|---|
| `app_state` | Última URL de PR aberta |
| `reviews` | Identificador `owner/repo#number` e arquivo selecionado |
| `file_progress` | Caminho, versão do diff, visto, aprovado sem ler, scroll vertical e horizontal |
| `review_activity` | Uma sessão por PR/dia, com data da última marcação |
| `repository_config` | Repositórios configurados como monorepo |
| `watched_repos` | Repos escolhidos para alertas, por conta, com último número de PR consultado |
| `review_drafts` | Lote local por PR, snapshot, comentários, revisão de concorrência e estado do envio |
| `codebases` | Caminhos e nomes dos serviços de cada repo |

O schema é versionado por `PRAGMA user_version` (atualmente 5). Autenticação continua com o `gh`; tokens nunca entram no banco. Metadados carregados, diffs e índices ficam em memória. Os objetos de código também persistem em um **cache Git bare separado**, em `app_cache_dir()/repositories`; não entram no SQLite. Filtros, abas de contexto e texto de comentário ainda não salvo ficam em memória. Rascunhos salvos persistem no SQLite. Veja [cache e retenção de código](code-workspace.md).

## Arquivo

`lince.sqlite3` dentro de `app_data_dir()` do Tauri, normalmente:

- macOS: `~/Library/Application Support/dev.lince.desktop/lince.sqlite3`
- Linux: `$XDG_DATA_HOME/dev.lince.desktop/lince.sqlite3`, ou `~/.local/share/dev.lince.desktop/lince.sqlite3`
- Windows: `%APPDATA%\dev.lince.desktop\lince.sqlite3`

SQLite pode manter `lince.sqlite3-wal` e `lince.sqlite3-shm` enquanto o banco estiver aberto. Para copiar o banco manualmente, feche o app antes, ou use a API de backup do SQLite; não copie apenas o arquivo principal durante uma gravação.

## Migração do JSON

Na próxima abertura, se o banco ainda não estiver inicializado, o Lince lê `progress.json` no mesmo diretório e importa todas as PRs, versões, marcações, seleção e posições. Criação das tabelas, importação e versão do schema são confirmadas juntas. A migração não altera o JSON original: ele é backup, não uma segunda fonte de dados.

Se a importação falhar, não é marcada como concluída e o JSON não é sobrescrito. O app apresenta o erro. Uma versão desconhecida do schema ou um banco corrompido também não causam exclusão automática.

## Consistência

Cada gravação salva seleção, arquivos e última URL em uma única transação. Falha implica rollback. Atualizar uma PR não regrava as outras; arquivos inalterados não recebem UPDATE. Operações de disco continuam em `spawn_blocking`, fora da thread de interface. WAL, `synchronous=FULL`, foreign keys e `busy_timeout` de 5 segundos estão habilitados.

Continua existindo debounce de 300 ms para scroll, gravação imediata ao trocar/revisar e flush antes de fechar. Encerramento forçado pode perder eventos ainda em memória. SQLite resolve concorrência física; edição lógica da mesma PR em duas instâncias ainda usa última gravação e não faz merge.

## Testes

`cargo test --manifest-path src-tauri/Cargo.toml progress::tests` verifica roundtrip, preservação de outras PRs, remoção de arquivos obsoletos, importação única, backup intacto, JSON inválido, rollback e rejeição de schema futuro/banco corrompido. Todos usam diretórios temporários, sem modificar o progresso real do usuário.

O schema 2 migra bancos da versão 1 sem perder progresso e acrescenta histórico e codebases. Detalhes da ordenação em [discovery.md](discovery.md).

O schema 3 acrescenta `watched_repos`, preservando dados dos schemas anteriores. O histórico é consultado por agregação de `reviews`, `file_progress` e `review_activity`, sem multiplicar contagens por sessão.

O schema 4 acrescenta `review_drafts`, preservando progresso e configurações. Cada lote guarda intervalos, lados e textos junto ao snapshot. Gravações de rascunhos usam transação imediata e revisão otimista: uma janela não sobrescreve silenciosamente os comentários de outra. O estado do envio é persistido antes da requisição e reconciliado por um marcador na revisão do GitHub; veja [comentários](code-workspace.md).

O schema 5 acrescenta `file_progress.approved_unread` com valor inicial falso, sem alterar marcações existentes. `reviewed` e `approved_unread` são mutuamente exclusivos na gravação. O histórico mantém contagens separadas; ambos retiram o arquivo dos pendentes, mas aprovação sem leitura não infla a contagem de arquivos vistos. As duas decisões são invalidadas se a versão do arquivo mudar. Pastas não gravam um estado independente: agregam todos os arquivos alterados descendentes, incluindo os ocultos por filtros.
