# Atualizações e releases

O Lince consulta `https://github.com/Wylp/Lince/releases/latest/download/latest.json` ao iniciar um build de release, a cada seis horas e ao recuperar foco (intervalo mínimo de uma hora). Uma versão nova exibe **Atualizar** na barra superior. O clique salva o progresso no SQLite, baixa e verifica o pacote assinado, instala e reinicia. Falhas aparecem com opção de tentar novamente. Builds de desenvolvimento não instalam atualizações.

## Preparação inicial

A chave privada foi gerada localmente em `.local/updater.key` (ignorada pelo Git). Guarde um backup seguro: as versões instaladas confiam na chave pública embutida em `src-tauri/tauri.conf.json`. Não substitua esse par nas próximas releases.

Configure no GitHub Actions de Wylp/Lince o secret `TAURI_SIGNING_PRIVATE_KEY` com o conteúdo do arquivo privado. A chave atual não tem senha; `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` pode ficar vazio. As chaves privadas e o log de geração nunca devem ser commitados. Nenhum secret foi enviado automaticamente.

## Publicação

1. Atualize a versão em package.json, package-lock.json, src-tauri/Cargo.toml, Cargo.lock e tauri.conf.json.
2. Faça commit e envie a tag correspondente, por exemplo `v0.1.0`.
3. O workflow Release compila macOS Apple Silicon e Intel, Windows x64 (NSIS) e Linux x64 (AppImage). Os jobs são sequenciais para evitar concorrência na escrita de latest.json.
4. Confira o job verify, os binários e publique o draft no GitHub Releases. Uma execução parcial permanece draft e não é oferecida aos usuários.

A primeira instalação é manual. Só releases publicadas, não prereleases, entram no endpoint latest. O botão instala versões superiores; não faz downgrade. GH CLI continua necessário para revisar PRs, mas não para consultar o atualizador público.

## Limites de validação e assinatura

Assinatura do atualizador é obrigatória e independente da assinatura do sistema operacional. macOS usa assinatura ad-hoc: ainda não há Developer ID/notarização, então a primeira instalação pode ser bloqueada pelo Gatekeeper. Windows não tem certificado Authenticode e pode solicitar confirmação do sistema. Linux exige executar a instalação AppImage em local gravável.

O fluxo de UI é testado com IPC simulado; a atualização real entre duas versões publicadas e os instaladores Windows/Linux precisam ser validados antes de anunciar distribuição estável. Não há release publicada automaticamente nesta implementação.

Referências: [updater oficial do Tauri](https://v2.tauri.app/plugin/updater/) e [tauri-action](https://github.com/tauri-apps/tauri-action).
