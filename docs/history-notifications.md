# Histórico e alertas

## Histórico de revisões

O botão **Histórico** fica ao lado de Listar PRs. Consulta o SQLite local, sem chamadas ao GitHub, e lista PRs com progresso salvo, inclusive revisões ainda sem marcações. Mostra repo/número, quantidade de arquivos revisados e data da última marcação. Datas de registros antigos não são inventadas.

Há busca por repo/número e filtro por pendentes/concluídas, aplicado ao último snapshot salvo. A lista exibe 30 PRs por vez. **Retomar** consulta a PR atual, carrega o lote e restaura seleção/scroll; novo push continua invalidando marcações conforme a política existente. “Concluída” significa todos os arquivos marcados localmente, não aprovação enviada ao GitHub. Títulos e autores não fazem parte do banco histórico atual.

## Alertas de novas PRs

Em **Listar PRs**, use **Avisar novas PRs** no cabeçalho do repositório. O Lince solicita permissão ao sistema e salva a seleção no SQLite. A primeira consulta estabelece o ponto de partida: PRs anteriores não geram alertas. Clique novamente para desativar. Até 20 repos por conta podem ser acompanhados.

O Rust consulta os repositórios a cada 2 minutos, enquanto o processo está aberto, inclusive com a janela minimizada. Não há serviço em segundo plano após encerrar o app. O botão **alertas** no topo permite consultar manualmente; o tooltip mostra a última consulta, e falhas aparecem na tela.

A consulta é autenticada pela conta ativa do gh, separa as escolhas por login e busca PRs por criação, com paginação de 100. Agrupa novas PRs abertas em uma notificação por repo (até três títulos no corpo). PRs que já fecharam entre consultas não notificam; passar draft para ready ou reabrir PR antiga também não conta como nova PR. Não há webhook nem servidor externo.

O cursor persiste entre reinícios. Ao voltar ao app, a próxima consulta pode avisar sobre PRs abertas desde a última verificação, ainda abertas. Sem rede ou com falha de envio, não avança o cursor. Se passar de 3.000 PRs desde a última consulta, pede para redefinir o acompanhamento. O polling não se sobrepõe a outro polling nem à alteração das escolhas, e respeita a concorrência de rede do app.

Entrega visual depende das permissões/Não Perturbe do sistema. Uma falha entre emitir o aviso e gravar o cursor pode repetir um alerta; não há garantia de entrega exatamente uma vez entre várias instâncias. Nesta versão clicar na notificação não abre automaticamente a PR. Use Listar PRs para abri-la.

Testes automatizados simulam permissões/IPC e validam o algoritmo de detecção. A entrega nativa deve ser conferida nos sistemas alvo; Windows precisa do app instalado para a identidade correta da notificação. Referência: [plugin oficial do Tauri](https://v2.tauri.app/plugin/notification/).
