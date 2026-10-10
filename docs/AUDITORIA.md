# Auditoria do sistema — confiabilidade dos diagnósticos

Data: 10/2026 · Escopo: código desta branch (Fases 1 e 2) · Método: leitura do código + reprodução automatizada do caso real
(`tests/caso-real.test.ts`).

## 1. Estado atual (o que existe)

| Camada | Implementação | Avaliação |
| --- | --- | --- |
| Coleta Meta | Graph API v26 com paginação, retry/backoff e respeito ao `x-business-use-case-usage`; estrutura de hora em hora, reprocessamento de 7 dias, backfill em fila, breakdowns e atividades | Sólido. Faltava conversão de moeda (ver P0-1). |
| Coleta Cakto | Webhook com segredo (tempo constante), payload bruto salvo, idempotência por chave, reprocessamento, status que não regride, conciliação pela API (beta) | Sólido. Faltava separar order bump/upsell (P0-2). |
| Tracking | Script first-party, Pixel + CAPI com mesmo `event_id`, `sck` no checkout, consentimento, verificador | Sólido. Sem validação de domínio/limite de taxa na coleta (P2). |
| Atribuição | 5 métodos com confiança numérica | Janela de tempo ambígua ainda atribuía (P0-4); sem níveis confirmada/provável/desconhecida. |
| Métricas | Funções puras e testadas | ROAS sobre receita líquida, impostos sobre o líquido, "lucro" sem custos variáveis (P0-3). |
| Decisão | Regras fixas (2× CPA alvo sem venda = pausar; 5 vendas = escalar) | Sem noção de incerteza estatística (P0-5/6). |
| IA | Parecer estruturado sobre números calculados | Bom desenho, mas herdava os números errados acima. |
| Segurança | Tokens AES-256-GCM, coluna de segredo inacessível ao navegador, RLS testado, SSRF no verificador | Bom. Logs sem redação estruturada (P2). |

## 2. Problemas encontrados (com evidência)

Reprodução do caso real com o código **antes** das correções (conta de anúncios em USD, R$ 100 de gasto, 3 vendas de R$ 97 + 2 order bumps de R$ 19,90, 1º dia, rastreamento incompleto):

| # | Problema | Evidência (código antigo) | Esperado |
| --- | --- | --- | --- |
| P0-1 | **Gasto em US$ tratado como R$.** O Meta devolve valores na moeda da conta; nada convertia. | ROAS 18,2 · CPA R$ 3,64 (sonda com US$ 18,18 a R$ 5,50) | ROAS 3,308 · CPA R$ 33,33 |
| P0-2 | **Order bump contado como compra.** Pedido de bump separado entrava como venda; bump dentro do pedido não era separado. Bump separado também gerava um 2º `Purchase` na CAPI, inflando as compras do Meta. | 5 "compras" | 3 compras principais + R$ 39,80 de bump |
| P0-3 | **"Lucro" = faturamento − tráfego.** Impostos sobre o líquido, sem custos variáveis do produto, reembolsos misturados, ROAS sobre receita líquida. | "Lucro" R$ 312 | Faturamento − tráfego R$ 230,80 *antes de outras despesas*; lucro de contribuição só com custos configurados |
| P0-4 | **Vendas sem origem ignoradas no veredito.** Campanha com 3 vendas não atribuídas era julgada como "sem venda". | Veredito **PAUSAR** no 1º dia | "Dados insuficientes / corrigir rastreamento" |
| P0-5 | **Confiança sem base estatística.** "Média" com 3 compras e 1 dia; critério = contagem fixa. | Confiança "media" | Baixa, com critérios explícitos |
| P0-6 | **Escala com 1 dia e 3 compras** quando a meta permitia. Regra fixa de +20%. | **ESCALAR** | Nunca escalar com 1 dia; incremento depende de margem e incerteza |
| P1-1 | Criativo com mais gasto marcado como "Queimando verba"/"Vencedor" sem teste estatístico; sem diferenciar distribuição do algoritmo de superioridade. | Rótulos por CPA pontual | Teste de taxas de Poisson + aviso de distribuição |
| P1-2 | Sem detecção de anomalias (queda de conversão, CPM, aprovação, webhook silencioso, sync parado). | — | Testes de Poisson/binomial com volume mínimo |
| P1-3 | Interface não separava dado confirmado de estimado (taxa estimada, câmbio, atribuição provável). | — | Selos "estimado" e painel de qualidade dos dados |
| P2-1 | `/api/collect` aceitava eventos de qualquer domínio, sem limite de taxa. | — | Validação de domínio + limite por IP |
| P2-2 | Logs com `console.*`, sem estrutura nem redação de tokens. | — | Logger JSON com redação |
| P2-3 | Janelas de decisão usavam a data do fuso do painel para dados do Meta (fuso da conta). | — | Datas do Meta no fuso da conta |

## 3. Priorização

| Prioridade | Item | Impacto | Risco | Esforço |
| --- | --- | --- | --- | --- |
| P0 | Câmbio (PTAX + IOF/spread configurável, marcado como estimado) | Crítico (todo CPA/ROAS de conta em US$) | Baixo | Médio |
| P0 | Composição do pedido (principal / bump / upsell) e CPA por compra principal | Crítico | Baixo | Médio |
| P0 | Modelo financeiro (bruto, reembolsos, taxas, impostos, custos variáveis, contribuição, equilíbrio) | Alto | Baixo | Médio |
| P0 | Níveis de atribuição + vendas sem origem consideradas no veredito | Crítico | Médio | Médio |
| P0 | Confiança estatística (intervalos de Poisson/Wilson, critérios transparentes) | Crítico | Baixo | Médio |
| P0 | Recomendações com ação, dados, confiança, riscos, impacto, invalidação e reavaliação | Alto | Médio | Alto |
| P1 | Inteligência de criativos com teste estatístico | Alto | Baixo | Médio |
| P1 | Detecção de anomalias | Alto | Baixo | Médio |
| P1 | Painel: resultado financeiro, recomendações priorizadas, qualidade dos dados, "como calculamos" | Alto | Baixo | Médio |
| P1 | IA recebe confiança, recomendações e lacunas; schema com "o que ainda não sabemos" | Médio | Baixo | Baixo |
| P2 | Coleta endurecida, logs estruturados, fuso da conta nas janelas | Médio | Baixo | Baixo |

O resultado da implementação está na seção 4.


## 4. O que foi implementado

Princípio geral: o sistema é **consultivo** — nada altera campanhas, orçamentos ou anúncios. Quando os dados não sustentam uma
conclusão, a resposta é "Dados insuficientes para recomendar escalonamento." com o que falta.

### P0 — números corretos

| Item | Onde | O que faz |
| --- | --- | --- |
| Câmbio | `src/lib/money/fx.ts`, `src/lib/money/fx-sync.ts`, `src/lib/integrations/bcb/ptax.ts`, migração `0003` | Gasto, valor de conversão e orçamentos da conta convertidos para R$ por dia: PTAX do Banco Central (última cotação até 10 dias antes) ou taxa manual, + IOF/spread configurável (padrão 3,5%). Tudo convertido é marcado **estimado**. Sem cotação: o gasto fica **fora das somas**, o painel mostra alerta crítico e o motor não recomenda escala. O cron grava a PTAX (incremental) antes do sync. Configuração por conta em Configurações. |
| Composição do pedido | `src/lib/integrations/cakto/parser.ts`, `src/lib/ingest/*`, `orderParts()` em `types.ts` | Principal / order bump / upsell, nos dois formatos (bump dentro do pedido ou pedido separado do produto marcado como bump). Só a compra principal conta como compra; bump separado vai à CAPI como evento personalizado `OrderBump` (não infla `Purchase`). |
| Modelo financeiro | `src/lib/metrics/finance.ts` | Bruto aprovado (principal, bumps, upsells), reembolsos/chargebacks, taxas (marcadas estimadas quando o webhook não traz o líquido), impostos sobre o faturamento após reembolsos, custos variáveis por produto (R$/venda e %), **faturamento − tráfego** e **lucro de contribuição** com nomes distintos (nenhum é lucro líquido), margem, CPA e ROAS de equilíbrio, observações do que é estimado. |
| Atribuição | `src/lib/attribution/attribute.ts` | Níveis confirmada (sck/src ou IDs nas UTMs) / provável (fbclid, hash, clique único na janela) / desconhecida. Janela de tempo com mais de um candidato **não atribui**. Venda sem origem nunca é dada ao anúncio que gastou mais. |
| Estatística | `src/lib/stats/core.ts` | Intervalo exato de Poisson (Garwood) para o CPA, Wilson para taxas, teste exato condicional para comparar criativos, binomial exato, probabilidade de 0 vendas, vendas necessárias para concluir, z robusto (mediana/MAD). |
| Confiança | `src/lib/stats/confidence.ts` | Baixa/moderada/alta com 6 critérios visíveis (compras, dias, cliques, precisão do CPA, qualidade da atribuição, estabilidade diária). Nível final = critério mais fraco. Texto explícito: confiança ≠ chance de dar certo. |
| Motor de decisão | `src/lib/decision/rules.ts` | Decide contra o **CPA de equilíbrio** do produto (ou o máximo definido por você). Lucro só "comprovado" quando o pior caso do IC 95% fica abaixo do máximo; prejuízo só quando o melhor caso (contando as vendas sem origem) fica acima. Nunca escala com < 3 dias, confiança baixa, tracking/dados com problema ou sem margem do produto. Corte por falta de venda é estatístico (chance de 0 vendas no CPA máximo ≤ 5%), não "2× o CPA". |
| Recomendações | idem | Manter, aumentar gradualmente (passo **proporcional à folga do CPA e à confiança**, entre 5% e 30% — sem percentual fixo), escala horizontal, variações de criativo, reduzir, pausar, aguardar, corrigir rastreamento, otimizar funil. Cada uma traz ação, dados, confiança, riscos, impacto financeiro estimado (faixa, quando calculável), o que a invalida, quando reavaliar e "Ver dados e cálculos". |

### P1 — inteligência e painel

- **Criativos** (`src/lib/creative/intelligence.ts`): cada criativo é comparado ao restante da campanha pela taxa de compras por real gasto; "destaque/abaixo comprovado" só com p < 0,05 **mesmo no pior cenário das vendas sem origem**. Aviso explícito quando o Meta concentrou o gasto ("previsão do algoritmo, não prova de venda"). Métricas: CTR (com teste de Wilson), CPC, custo por checkout, hook, hold e retenção 25/50/75/100%, frequência, CPA com IC. Sugestão de teste controlado (mesmo orçamento por criativo ou Teste A/B do Gerenciador).
- **Anomalias** (`src/lib/anomalies.ts`): CPM (z robusto), queda de conversão/CPA (Poisson), taxa de checkout (binomial), aprovação de Pix e cartão (binomial), sync do Meta atrasado, webhook da Cakto sem eventos com atividade no Meta, pedidos possivelmente duplicados, divergência de receita Meta × Cakto, falhas da CAPI. Cada verificação diz o critério; o que está dentro do ruído aparece como "normal", e sem base suficiente como "sem dados" (não chuta). Anomalias reais viram alertas persistidos e notificados.
- **Painel**: resultado financeiro com composição e "como calculamos", recomendações priorizadas, qualidade dos dados (origem das vendas por nível, atualização de cada fonte, situação do câmbio), anomalias, Meta e Cakto sempre separados. Na campanha: critérios de confiança, IC do CPA, recomendações completas e, quando há vendas sem origem, **intervalo** "só com origem → se todas as sem origem fossem daqui" em vez de um prejuízo falso.
- **IA**: o retrato enviado ao Claude inclui financeiro, níveis de atribuição, vendas e faturamento sem origem, critérios de confiança, IC do CPA, recomendações do motor e a análise de criativos; o schema ganhou `o_que_nao_sabemos` e `o_que_mudaria_a_decisao` e a confiança passou a baixa/moderada/alta. O prompt proíbe regras universais, atribuição por gasto e "faturamento − tráfego" como lucro. O parecer sem IA usa as recomendações do motor (removido o "+20%" fixo).

### P2 — robustez e segurança

- `/api/collect`: rejeita eventos cuja página/origem não pertence ao domínio cadastrado do site (403) e limita rajadas por IP+site (120/min, por instância).
- Logger estruturado (`src/lib/log.ts`) com remoção de segredos (token do Meta, chaves, Bearer, JWT, `access_token=` em URLs); mensagens de erro do Meta passam pela mesma redação antes de irem para o banco/interface.
- Janelas de decisão no **fuso da conta de anúncios** (mesmo fuso em que o Meta fecha o dia do gasto).
- Entregas repetidas do webhook da Cakto contadas em `duplicate_count`.

### Além do que foi pedido

- Cenário **"Caso real (dia 1, US$)"** selecionável no banner do modo demo, para ver o caso na interface.
- Regra de "reduzir" para CPA muito acima do máximo e improvável no equilíbrio (≤ 20%), sem declarar prejuízo comprovado.
- O "orçamento mínimo de teste" definido por você no produto é respeitado antes de qualquer corte.
- As vendas sem origem que entram no cálculo de uma campanha são só as do produto dela (quando vinculado) e excluem UTMs de outras fontes (Google, TikTok, e-mail...).

## 5. Testes e evidências

`npm test` — **104 testes em 12 arquivos, todos passando**; `tsc`, ESLint (0 avisos) e `next build` limpos.

| Arquivo | Cobertura |
| --- | --- |
| `tests/caso-real.test.ts` (8) | Caso real de ponta a ponta pelo mesmo código das telas (repositório `CasoRealRepository`) |
| `tests/rules.test.ts` (18) | Motor: sem vendas, corte estatístico, reduzir, prejuízo comprovado × vendas sem origem, escala só com lucro comprovado e passo proporcional, 1 dia, tracking/dados/margem ausentes |
| `tests/intelligence.test.ts` (16) | Criativos, anomalias (ruído × anomalia × sem base), câmbio/PTAX, redação de logs, domínio e limite da coleta |
| `tests/finance.test.ts` (7), `tests/stats.test.ts` (7), `tests/attribution.test.ts` (8) | Modelo financeiro (inclusive os dois formatos de bump), intervalos e testes estatísticos, níveis de atribuição |
| Demais (`cakto-webhook`, `fase2`, `metrics`, `tracking`, `crypto`, `sql/migration`) | Webhook (segredo, idempotência, eventos fora de ordem, reprocessamento), deduplicação, RLS e migrações em Postgres (PGlite) |

### Caso real — resultado

| Verificação | Esperado | Obtido |
| --- | --- | --- |
| Faturamento bruto | R$ 330,80 | R$ 330,80 (principal R$ 291,00 + bumps R$ 39,80) |
| Faturamento − tráfego | R$ 230,80 | R$ 230,80 |
| ROAS | 3,308 | 3,308 (exibido como 3,31x) |
| CPA | ~R$ 33,33 | R$ 33,33 (3 compras principais; bumps não contam) |
| Gasto | US$ 20 ≈ R$ 100 | R$ 100,00, marcado "câmbio estimado" (taxa manual R$ 5,00 no cenário) |
| Lucro de contribuição | — | R$ 205,72 estimado (taxas da Cakto descontadas; aviso de impostos 0% e custos não configurados) |
| Criativo de maior gasto (US$ 13 = 65%) | não recebe as vendas | 0 vendas, "Inconclusivo", aviso de distribuição do algoritmo |
| Veredito | sem escala agressiva | "Aguardar dados" — "Dados insuficientes para recomendar escalonamento. As vendas do período não têm origem identificada." — confiança baixa; 1ª recomendação: corrigir o rastreamento |
| Resultado da campanha | não concluir prejuízo | Intervalo −R$ 100,00 (só com origem) até R$ 205,72 (se as 3 sem origem fossem dela) |

Capturas: `docs/screenshots/caso-real-*.png` e `docs/screenshots/demo-*.png`.

## 6. O que NÃO foi verificado (limitações honestas)

- **IA (Claude)**: o caminho com `ANTHROPIC_API_KEY` não foi executado aqui (sem chave). Validados: o schema (inclusive a conversão para saída estruturada) e o parecer automático sem IA.
- **PTAX do Banco Central**: a rede deste ambiente bloqueia `olinda.bcb.gov.br` (testado: CONNECT recusado). URL e parser seguem a documentação pública e estão testados com resposta simulada; a primeira execução real precisa ser conferida no log do cron. Enquanto isso, a taxa manual cobre o caso.
- **Meta Marketing API e Cakto ao vivo**: nenhuma chamada real foi feita (sem credenciais). Os adaptadores são tolerantes e guardam o payload bruto; os campos de itens/order bump da Cakto seguem o que a documentação pública indica e devem ser conferidos no primeiro webhook real (o payload bruto fica salvo para isso).
- **Supabase ao vivo**: migrações e RLS foram validadas em Postgres local (PGlite), não numa instância Supabase real.
- **Limite de taxa da coleta**: é por instância (memória); em várias instâncias serverless é melhor esforço. Validação de domínio usa `Origin`/URL — protege contra poluição casual, não contra quem forja cabeçalhos.
- **Modelo estatístico**: compras ~ Poisson proporcional ao gasto. O leilão não é estacionário (dia da semana, horário, aprendizado); os intervalos são uma referência honesta, não uma garantia.
