# Identidade do Lince

Logo criada com a ferramenta integrada `image_gen` (skill `imagegen`), usando o Corvo fornecido pelo usuário como referência de linguagem visual: silhueta angular, facetas sobrepostas e olhar atento. O animal foi convertido em lince e a paleta em verde, mantendo o fundo transparente.

Asset principal: `src/assets/lince-logo.png`. Ícones desktop derivados com `npm run tauri icon -- src/assets/lince-logo.png --output src-tauri/icons`; apenas saídas desktop são mantidas. O PNG original permanece no projeto como fonte raster; não há SVG vetorial nesta versão.

Prompt final usado na ferramenta integrada:

> Use case: logo-brand. Create an original app logomark for Lince, a desktop code review app. Reference is a sleek angular raven head silhouette with layered sweeping facets; translate that visual language into an unmistakable LYNX head in left-facing three-quarter/profile view, with tall pointed ears and prominent ear tufts, short feline muzzle (no beak), keen negative-space eye and sculpted cheek fur. Compact powerful silhouette, clean vector-like edges, 3-5 broad sweeping facets, restrained emerald to mint green gradients (#8ed7ae highlights, #39a875 midtones, deep forest green shadows), legible small. Transparent background with real alpha, no background rectangle, no drop shadow, no text, no letters, no border, no mockup. Square composition, mark fills 85% with comfortable margins. Premium calm developer-tool identity, black/green palette. The supplied raven image is only a style reference, not an edit target. Save a PNG asset and provide its local file path.

A barra da janela usa a paleta preto/floresta, marca à esquerda e contexto da PR no centro. No macOS, o estilo Overlay mantém os controles nativos; Linux e Windows usam botões próprios com as APIs de minimizar, maximizar/restaurar e fechar do Tauri. Fechar solicita o evento normal de fechamento, preservando a gravação de progresso. A área livre permite arrastar e o Tauri gerencia duplo clique. As permissões ficam limitadas à janela principal.

Autenticação é consultada com `gh api --hostname github.com --method GET user`: exibe o login efetivamente usado nas consultas, sem ler ou enviar tokens à interface. Verifica ao iniciar, ao retornar ao app (intervalo mínimo de 15 segundos) ou pelo botão de atualizar. Falha de rede não é rotulada como logout. CLI ausente e sessão sem autenticação têm orientações distintas.

Validação desta alteração: 6 testes frontend, 5 testes Rust e 10 cenários Playwright (Chromium/WebKit) passaram, além do build desktop macOS. Screenshot da tela inicial no WebKit conferido. Controles e sobreposição nativos macOS, Linux e Windows ainda precisam de validação interativa; o teste de navegador não comprova integração com o gerenciador de janelas.
