# Carregamento de PRs em lote

Abrir uma PR prepara **todos os arquivos alterados** antes de entrar na revisão. Trocar de arquivo não dispara requisições ao GitHub. `get_pr_files(snapshotId)` retorna `{ snapshot, files }`, com mapa por caminho contendo `before`, `after` e `diff`. Conteúdo não suportado é `null`, acompanhado de motivo; lados inexistentes de inclusões/remoções são strings vazias.

## Fluxo atual

1. REST via `gh`: metadados, merge-base, listagem paginada de arquivos e verificação final de base/head estáveis.
2. Cache Git bare próprio: fetch raso dos commits ausentes, autenticado pelo gh, sem tocar no checkout do usuário.
3. `git ls-tree` local nos SHAs fixados resolve caminhos, modos, tamanhos e OIDs. `git cat-file --batch` lê os blobs deduplicados em um processo local, validando cabeçalhos, tamanhos e delimitadores.
4. Rust valida o conteúdo e calcula os patches completos. `get_repository_index` fornece ambas as árvores, sem pré-carregar documentos de análise JS/TS. Arquivos de contexto adicionais vêm de `read_repository_file`, que lê exclusivamente objetos do cache local.

A implementação anterior usava lotes GraphQL de blobs. O cache Git agora permite explorar também arquivos não alterados, sem consultas HTTP individuais. Metadados continuam usando a API; downloads Git transferem objetos e não são uma única chamada REST. Objetos já presentes são reutilizados. A abertura exige rede para conferir metadados; ainda não há modo de reabertura totalmente offline.

Patches REST ausentes ou truncados nunca são usados como fonte de verdade. Binários, não UTF-8, LFS, links simbólicos e submódulos ficam explicitamente indisponíveis para revisão textual.

## Limites

Um snapshot completo fica em memória no backend. Abrir outro com sucesso substitui o anterior; uma falha preserva o anterior. Blobs iguais usam `Arc`. O frontend monta somente o editor ativo, mas mantém modelos usados na navegação e no índice semântico.

- 3.000 arquivos alterados por PR; 100.000 entradas por árvore do repositório.
- 1 MiB por arquivo, 12.000 linhas, 4.000 bytes por linha; até 16.000 linhas no patch calculado.
- 64 MiB de blobs únicos por lote e 64 MiB de conteúdo antes/depois dos arquivos alterados; 32 MiB de patches.
- 30 segundos para o cálculo total dos diffs; 180 segundos por processo Git.
- JS/TS: dependências do arquivo consultado são carregadas por demanda, com orçamento de 32 MiB por grafo e limites de trabalho documentados. `read_repository_files` aceita até 64 caminhos / 8 MiB por lote local; o frontend usa lotes de oito arquivos.
- O antigo limite inicial de 2.000 documentos / 16 MiB, somando base e head, foi removido. Os limites dos índices sintáticos das outras oito linguagens continuam separados.

Exceder limites de um arquivo bloqueia sua revisão; exceder os limites globais impede abrir um snapshot parcial silenciosamente. Esses limites de memória não limitam o tamanho do download Git ou do cache em disco. Veja [cache, editor e limitações](code-workspace.md).

Previews de Python, Java, C#, Go, Rust, C, C++ e PHP preparam um índice sintático sob demanda, com um lote local por linguagem/lado. Não ampliam o lote inicial de abertura nem fazem consultas HTTP por arquivo. Limites próprios e a diferença em relação à navegação semântica JS/TS estão em [code-workspace.md](code-workspace.md).
