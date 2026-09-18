# Persistência local em SQLite

O Lince usa SQLite incorporado ao executável, via `rusqlite`/`bundled`. Não precisa instalar SQLite nem iniciar serviço.

## O que é persistido

| Tabela | Conteúdo |
|---|---|
| `app_state` | Última URL de PR aberta |
| `reviews` | Identificador `owner/repo#number` e arquivo selecionado |
| `file_progress` | Caminho, versão do diff, revisado, scroll vertical e horizontal |
| `review_activity` | Uma sessão por PR/dia, com data da última marcação |
| `repository_config` | Repositórios configurados como monorepo |
| `watched_repos` | Repos escolhidos para alertas, por conta, com último número de PR consultado |
| `codebases` | Caminhos e nomes dos serviços de cada repo |

O schema é versionado por `PRAGMA user_version` (atualmente 3). Autenticação continua com o `gh`; tokens nunca entram no banco. Metadados carregados, diffs e árvores Git permanecem em caches de memória. Filtros e estados temporários da interface também ficam em memória.

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
