# Carregamento de PRs em lote

Abrir uma PR prepara **todos os arquivos alterados** antes de entrar na revisão. Trocar de arquivo não dispara requisições ao GitHub. O comando `get_pr_files(snapshotId)` retorna `{ snapshot, files }`, com um mapa por caminho contendo `before`, `after` e `diff`. Conteúdo não suportado é `null`, acompanhado do motivo no diff. Lados inexistentes de inclusões/remoções são strings vazias. Esta API permite reutilizar o mesmo conteúdo em novas features.

## Requisições

1. Metadados, merge-base e listagem paginada de arquivos, seguidos de verificação de base/head estáveis.
2. Duas árvores Git recursivas, fixadas no merge-base e head: resolvem caminhos, modos, tamanhos e SHAs.
3. Blobs deduplicados por SHA, em consultas GraphQL com aliases: até 40 objetos ou 4 MiB de conteúdo por lote. Arquivos não suportados pelo modo/tamanho não são buscados.
4. Conteúdos são validados por OID, byteSize, isTruncated, UTF-8 e tamanho efetivamente recebido. Os diffs completos são calculados em Rust fora da thread da interface.

Para até 100 arquivos e um único lote de conteúdo, são **7 chamadas gh api**: quatro de metadados/listagem, duas de árvores e uma GraphQL. PRs maiores exigem páginas/lotes adicionais. Não prometemos uma única requisição HTTP para toda PR, pois há limites da API e do payload. O custo GraphQL e os limites REST são distintos; reduzir chamadas não elimina rate limiting.

Não baixamos o repositório inteiro, não fazemos checkout e não buscamos blobs individualmente ao navegar. O endpoint REST de patches não é usado como fonte do diff, pois pode truncar patches. Árvores truncadas ou respostas incompletas de objetos impedem abrir um lote inconsistente. Conteúdo binário, não UTF-8, LFS, modo não suportado ou blob truncado fica explicitamente indisponível para revisão textual.

## Memória e limites

Um snapshot completo fica em memória no backend. Abrir outro snapshot com sucesso substitui o anterior; falha preserva o último. Reabrir o mesmo ID valida metadados e reutiliza o lote. Conteúdos são compartilhados com `Arc`, evitando duplicação para blobs iguais. O frontend mantém somente a renderização do diff atual.

Limites: 1 MiB por arquivo, 12.000 linhas, 4.000 bytes por linha, 32 MiB de blobs únicos por snapshot, 32 MiB de patches resultantes, 64 MiB de conteúdo antes/depois (incluindo repetições) e 30 segundos de cálculo dos diffs. Os limites anteriores de 3.000 arquivos por PR e 32 MiB por resposta continuam. Lotes excedentes são recusados explicitamente; não há fallback silencioso que retome consultas arquivo a arquivo. A abertura pode demorar mais que o carregamento sob demanda, em troca de navegação sem rede depois.

Referências: [objetos Blob GraphQL](https://docs.github.com/en/graphql/reference/git), [Repository.object](https://docs.github.com/en/graphql/reference/repos), [árvores Git](https://docs.github.com/en/rest/git/trees).
