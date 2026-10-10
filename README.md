# Central de Comando de Meta Ads

Tracking completo + consultor de tráfego embutido para quem vende infoprodutos com Meta Ads e recebe pela Cakto.
Responde, no primeiro olhar: **como estão minhas campanhas hoje e o que eu faço agora** (Escalar / Manter / Otimizar / Pausar / Aguardar dados).

> Nome provisório. Sugestão: **Rumo** — o sistema existe para dizer o rumo de cada campanha.

## Status

| Fase | Conteúdo | Status |
| --- | --- | --- |
| 1 | Fundação e tracking (auth, workspaces, Meta, gasto por dia, campanhas, script, Cakto, CAPI, saúde, demo) | **Entregue** |
| 2 | Breakdowns de público, Parecer do Consultor com IA, alertas (painel + e-mail/Telegram), chat “Perguntar ao consultor”, eventos na linha do tempo | **Entregue** |
| 3 | Descobrir & Criar (nichos, `AdLibraryProvider`, kit completo, prompt Lovable) | — |
| 4 | Criativos (Google Flow assistido) e Estúdio de PDF | — |
| 5 | Parecer vs. resultado, relatórios semanais, multiusuário | — |

## Rodar localmente (modo demo, sem nenhuma credencial)

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 55 testes (métricas, regras, atribuição, idempotência, deduplicação, SQL/RLS, públicos, alertas, parecer)
```

Sem Supabase configurado o app abre em **modo demonstração**: dados fictícios (claramente sinalizados) e um site/segredo de teste
para você experimentar o script e o webhook localmente:

- Script: `<script src="http://localhost:3000/t.js" data-site="demo_site" async></script>`
- Webhook: `POST http://localhost:3000/api/webhooks/cakto` com `"secret": "demo-secret"` no corpo.

Os eventos aparecem em **Saúde do tracking → Eventos em tempo real** e as vendas em **Vendas** (ficam só na memória do servidor).

## Fase 2 — Inteligência

- **Análise de públicos** (página da campanha): idade, gênero, idade+gênero, posicionamento, dispositivo, região, horário e dia da semana,
  com selos “converte barato”, “caro” e “queima dinheiro”. Sincronizado uma vez por dia (últimos 14 dias). Compras aqui são as do Meta,
  porque a Cakto não informa idade/posicionamento.
- **Motor de decisão**: além dos sinais da Fase 1, detecta saturação de público (CPM ↑ + frequência + alcance novo ↓), fadiga de criativos,
  pacing do dia e usa metas ajustáveis por produto (kill, frequência máxima, volume mínimo, orçamento mínimo de teste) em Configurações.
- **Parecer do Consultor**: a IA recebe o retrato completo já calculado (janelas 1/3/7 dias, funil, série diária, conjuntos, anúncios,
  públicos, eventos, tracking e o parecer anterior) e devolve o parecer na estrutura fixa (veredito, diagnóstico em 3 linhas, gargalo,
  plano de 3–7 dias, testes, riscos, o que não mexer, 3 caminhos, próximos criativos). Saída estruturada validada por schema; fallback
  de recusa no servidor ativado (`fallbacks: "default"`). Cada parecer fica salvo com o retrato de entrada, para comparar depois.
  Sem `ANTHROPIC_API_KEY`, o sistema gera um **parecer automático das regras** (mais simples) e avisa.
- **Perguntar ao consultor**: chat com streaming e todos os dados da campanha.
- **Alertas**: CPA acima da meta, ROAS baixo, gasto sem venda, frequência, saturação, fadiga, queda de entrega, anúncio reprovado,
  conta com problema, cliques sem visualização da página, webhook/script parado, token expirando, falhas de CAPI e atribuição baixa.
  Ficam abertos até a condição sumir; notificação por e-mail (Resend) e Telegram só quando o alerta é novo.
- **Linha do tempo**: mudanças de orçamento, status, criativo e público vindas do Meta (atividades da conta) e saída/limitação da fase de
  aprendizado detectada no sync, além das suas anotações.

## Auditoria de confiabilidade (diagnósticos e recomendações)

Relatório completo, com evidências, priorização, testes e limitações: [`docs/AUDITORIA.md`](docs/AUDITORIA.md).

- **Consultivo**: o sistema nunca altera campanhas, orçamentos ou anúncios — você decide e executa.
- **Moeda**: conta de anúncios em US$ (ou outra) é convertida para R$ (PTAX do Banco Central ou taxa manual + IOF/spread) e marcada
  como estimada. Sem cotação, o gasto não é somado e o painel avisa. Configure em Configurações → Contas de anúncio e câmbio.
- **Compras**: só a compra do produto principal conta. Order bumps e upsells entram no faturamento, não no CPA.
- **Financeiro**: faturamento bruto, reembolsos, taxas, impostos, custos variáveis por produto, *faturamento − tráfego* e *lucro de
  contribuição* (nenhum dos dois é lucro líquido), CPA e ROAS de equilíbrio.
- **Atribuição**: confirmada / provável / desconhecida. Venda sem origem nunca vai para o criativo que gastou mais.
- **Decisão com incerteza**: intervalo de 95% do CPA contra o CPA de equilíbrio; confiança baixa/moderada/alta com critérios visíveis;
  sem escala com menos de 3 dias, confiança baixa ou tracking com problema. Na dúvida: “Dados insuficientes para recomendar
  escalonamento.”
- **Criativos e anomalias**: comparação estatística entre criativos e detecção de anomalias que separa ruído de problema real.
- **Ver o caso real**: no modo demo, clique em “Caso real (dia 1, US$)” no banner.

## Colocar em produção

1. **Supabase**: crie um projeto. Em *SQL Editor*, rode `supabase/migrations/0001_init.sql` (ou `supabase db push`).
   Em *Authentication → URL Configuration*, coloque a URL do app e `https://SEU-APP/auth/callback` como redirect.
2. **Vercel**: importe o repositório e configure as variáveis do `.env.example`.
   Gere `ENCRYPTION_KEY` com `openssl rand -base64 32` e um `CRON_SECRET` qualquer.
   A geração do Parecer pode levar 1–2 min (`maxDuration = 300` na página da campanha); se o seu plano limitar menos que isso,
   use `ANTHROPIC_EFFORT=medium`.
   O `vercel.json` agenda o sync de hora em hora e o reprocessamento diário — **o plano Hobby só permite cron diário**;
   no Hobby, o sync horário precisa do plano Pro ou de um agendador externo chamando `/api/cron/meta-sync?mode=hourly`
   com `Authorization: Bearer <CRON_SECRET>`.
3. Acesse o app, crie a conta e siga **Conexões** (≈10 min): Meta → Pixel/CAPI → script na página → Cakto → produto.

## Credenciais necessárias (lista única)

| Onde | O quê | Obrigatório? |
| --- | --- | --- |
| Supabase | URL, anon key, service role key | Sim (sem isso = modo demo) |
| Servidor | `ENCRYPTION_KEY`, `CRON_SECRET` | Sim |
| Meta | Token de **Usuário do Sistema** (Business Manager) com `ads_read`, `business_management` (`ads_management` só para criar campanhas no futuro); ID da conta de anúncios; **Pixel ID** | Sim |
| Meta | App ID + App Secret | Só para “Entrar com Facebook” e ler a validade do token |
| Meta | Token da API de Conversões (Gerenciador de Eventos) | Opcional (senão usa o token principal, que precisa ter acesso ao Pixel) |
| Cakto | **Segredo do webhook** (gerado ao criar o webhook) | Sim |
| Cakto | client_id/client_secret da API | Opcional (conciliação) |
| Anthropic | `ANTHROPIC_API_KEY` | Para o Parecer da IA e o chat (sem ela, parecer automático das regras) |
| Resend | `RESEND_API_KEY` + `ALERTS_FROM_EMAIL` (domínio verificado) | Opcional — alertas por e-mail |
| Telegram | `TELEGRAM_BOT_TOKEN` (via @BotFather) | Opcional — alertas no celular |

Tokens e segredos são salvos **criptografados (AES-256-GCM)** e a coluna é inacessível ao navegador (testado).

## O que as APIs não permitem — e o fallback usado

| Escopo pedido | Limitação real | Fallback |
| --- | --- | --- |
| Biblioteca de Anúncios “turbinada” (Fase 3) | A API oficial da Ad Library só cobre anúncios políticos/sociais e, na UE, todos os anúncios. Não entrega anúncios comerciais do Brasil de forma ampla. | Camada `AdLibraryProvider`: importação manual/assistida por link, provedor terceiro via API key, e “seeds” da IA marcadas como estimativa. Sem scraping que viole os termos. |
| Google Flow (Fase 4) | O Flow não tem API pública; o Veo existe na API do Gemini, mas é pago e não usa os créditos gratuitos do Flow. | Fluxo assistido: prompts por cena, fila diária, “Copiar prompt”/“Abrir Flow”, upload de volta com nomenclatura. Adaptador pronto para plugar a API do Veo. |
| Lovable (Fase 3) | Não há API para criar projetos. Existe o “Build with URL” (link com prompt). | Prompt completo + botão que abre o Lovable com o prompt (formato do link isolado num adaptador) e “Copiar prompt”. |
| Cakto | Webhook documentado envia `secret` no corpo (sem assinatura HMAC). Nomes exatos de campos e a paginação da API de pedidos não puderam ser confirmados daqui. | Validação do segredo em tempo constante, payload bruto sempre salvo, parser tolerante (`src/lib/integrations/cakto/parser.ts`), endpoints da API configuráveis. |
| Repasse de parâmetros ao checkout | A Cakto não documenta publicamente quais parâmetros de URL devolve no webhook. | O script anexa UTMs + `sck=<sessão>` (configurável); o parser procura em vários campos e na `checkoutUrl`. Se nada voltar, a atribuição cai para fbclid → e-mail/telefone com hash → janela de tempo, registrando método e confiança. |
| Purchase em dobro | Se o Pixel também estiver configurado dentro da Cakto com evento de compra, os `event_id` são diferentes e o Meta conta duas vezes. | Aviso na tela de Conexões: desative o Purchase do Pixel na Cakto e deixe a CAPI enviar. |
| Alcance/frequência do período | Alcance não é somável entre dias. | Frequência exibida como aproximação (impressões ÷ soma do alcance diário), com aviso no tooltip. |
| Alertas por WhatsApp | Exige a API oficial do WhatsApp Business (aprovação da Meta). | Telegram como canal de celular; e-mail via Resend. |
| Breakdowns por região | O Meta limita conversões em alguns detalhamentos por privacidade. | Mostra o que vier, com aviso na aba Região; falha de um breakdown não derruba os outros. |
| Verificador na Vercel | Não há navegador headless na Vercel por padrão. | Modo HTML estático + painel de eventos ao vivo. Com Chromium disponível (`CHROMIUM_PATH`), usa o modo navegador. |

## Arquitetura

```
src/
  app/(painel)/            telas: visão geral, gasto por dia, campanhas, campanha, vendas, saúde, conexões, configurações
  app/t.js/                script de tracking servido para as páginas
  app/api/collect          eventos do script (→ CAPI depois da resposta)
  app/api/webhooks/cakto   webhook da Cakto
  app/api/cron/meta-sync   sync do Meta (hourly | daily)
  app/api/meta/oauth/*     Entrar com Facebook
  lib/metrics/             métricas calculadas (determinísticas) + textos dos tooltips
  lib/decision/rules.ts    motor de regras (Camada 1 do consultor)
  lib/attribution/         atribuição venda → anúncio (método + confiança)
  lib/ingest/              coleta, webhook, CAPI — sobre uma interface IngestStore (memória | Supabase)
  lib/integrations/meta    cliente Graph com retry/backoff, insights, OAuth, CAPI, sync
  lib/integrations/cakto   parser tolerante + adaptador da API
  lib/tracking/            fonte do t.js e verificador de instalação
  lib/data/                repositório de leitura (demo | Supabase)
supabase/migrations/       schema completo (todas as tabelas do escopo, com workspace_id + RLS)
tests/                     Vitest + Postgres embarcado (PGlite) para validar SQL e RLS
```

Regras de projeto: a IA nunca calcula números (recebe o resultado de `lib/metrics` e `lib/decision`); integrações ficam isoladas em
`lib/integrations/<serviço>` com parser tolerante e payload bruto salvo, para ajustar mudanças de API trocando um arquivo.

## Parâmetros de URL dos anúncios

Cole em *Anúncio → Rastreamento → Parâmetros de URL*:

```
utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}|{{campaign.id}}&utm_term={{adset.name}}|{{adset.id}}&utm_content={{ad.name}}|{{ad.id}}
```

Os IDs ligam cada venda ao anúncio exato, mesmo se você renomear campanhas.
