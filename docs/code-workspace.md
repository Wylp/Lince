# Revisão como navegação de código

O workspace usa **Monaco Editor 0.56**, editor do VS Code, para diff lado a lado, arquivo completo, destaque por linguagem e navegação. Todos os editores e previews são somente leitura (`readOnly`, `domReadOnly`, `originalEditable: false`). Não há comandos para salvar arquivos do projeto.

## Navegação

- **Alterações** mostra os arquivos da PR; **Explorador** inclui os arquivos não alterados, no head ou na base comum.
- Abas (até 12), histórico voltar/avançar, **Cmd/Ctrl+P** para localizar arquivos.
- **Cmd/Ctrl+click** ou **F12** abre a definição; **Alt+F12** / Preview mostra a definição em um diálogo. Referências usa o serviço de linguagem do TypeScript.
- Arquivo completo e diff compartilham o snapshot. A origem base/head permanece identificada e a navegação no lado antigo usa a base.
- Posição dos diffs alterados, seleção e marcações persistem em SQLite. Abas, posições de arquivos de contexto, filtros e rascunhos de comentário ficam em memória nesta versão.

Definições, referências e hover semântico estão implementados para **JavaScript/TypeScript**. As demais linguagens têm destaque de sintaxe e navegação pela árvore, sem servidor de linguagem integrado. Não usamos correspondência textual para fingir resolução de símbolos.

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
