/**
 * Manual de tráfego do Claudinho: as regras que ele segue em cada decisão.
 * São práticas consolidadas de compra de mídia no Meta para infoproduto
 * (CBO, aprendizado, escala, corte, criativo, ticket) — aplicadas SEMPRE sobre
 * os números medidos da conta. Nada aqui substitui o dado: sem volume, a regra
 * é esperar e dizer o que observar.
 */

export interface PlaybookRule {
  area: string;
  rules: string[];
}

export const PLAYBOOK: PlaybookRule[] = [
  {
    area: "Missão e verdade dos números",
    rules: [
      "A meta é DINHEIRO LÍQUIDO no mês: faturamento aprovado na Cakto − reembolsos − taxas − impostos − custos − gasto com anúncios. ROAS e CPA são meios, não o fim.",
      "A fonte da verdade das vendas é a Cakto (webhook), não o Meta. O Meta costuma contar compras a mais (Pix gerado, janela de visualização).",
      "Venda sem origem não é atribuída a nenhuma campanha. Nunca dar o crédito para quem gastou mais.",
      "Toda ação vem com número: campanha, valor atual → valor novo NA MOEDA DA CONTA, condição para reverter e quando reavaliar.",
    ],
  },
  {
    area: "Economia por oferta",
    rules: [
      "Lucro por cliente = líquido do pedido (principal + bump + upsell, já sem taxa da Cakto) − impostos − custos − CPA.",
      "CPA de equilíbrio = líquido por cliente antes do tráfego. Para ESCALAR, o CPA dos últimos 3 dias deve estar até ~75% do equilíbrio; entre 75% e 100% é manter/otimizar; acima de 100% por 2 dias é cortar ou consertar o funil.",
      "Concentre a verba no motor de lucro (a oferta com maior lucro por cliente × volume possível). Testes novos recebem no máximo 15–20% da verba diária.",
      "Produto de ticket baixo (< R$ 20) só se paga com funil: bump + upsell de 1 clique + downsell. Ticket médio por cliente precisa ficar ≥ 1,3× o CPA. Sem isso, ele é porta de entrada que dá prejuízo.",
      "Calcule a meta de volume: vendas/dia necessárias = lucro/dia que falta ÷ lucro por cliente da oferta.",
    ],
  },
  {
    area: "Escala (CBO — orçamento na campanha)",
    rules: [
      "O orçamento é da CAMPANHA (CBO). Nunca mexer em orçamento de conjunto ou anúncio.",
      "Escala vertical: +20% (no máximo +30%) a cada 48–72 h, só com CPA 3d ≤ alvo e pelo menos 3 vendas reais nos 3 dias. Nunca mais de +50% em um dia.",
      "Mudança de orçamento perto da virada do dia no fuso da conta (fim da noite ou bem cedo), para o dia novo já começar com o orçamento novo.",
      "Reverter para o orçamento anterior se o CPA 3d passar do máximo por 2 dias seguidos depois de um aumento.",
      "Escala horizontal quando a vertical travar (CPA sobe a cada aumento, frequência > 2,5, CPM subindo): duplicar a campanha vencedora com público diferente (amplo, interesse, lookalike de compradores) e os criativos vencedores.",
      "Não seguir nem aplicar recomendações automáticas do Meta (\"pontuação de oportunidade\", sugestões, auto-aplicar) — preferência do dono da conta.",
    ],
  },
  {
    area: "Fase de aprendizado",
    rules: [
      "O Meta precisa de ~50 conversões por semana por conjunto para estabilizar. Com pouco volume, poucos conjuntos e verba concentrada.",
      "Não editar público, criativo e orçamento ao mesmo tempo; uma alteração significativa por vez, e esperar 48–72 h.",
      "Conjuntos que nunca saem do aprendizado com gasto relevante: consolidar.",
    ],
  },
  {
    area: "Corte e diagnóstico do funil",
    rules: [
      "Cortar por falta de venda só quando o gasto sem venda torna improvável um CPA dentro do máximo (≈ 3× o CPA máximo sem nenhuma venda).",
      "CTR de link < 0,8% ou hook rate < 20%: o problema é o criativo (gancho dos 3 primeiros segundos).",
      "Connect rate (visualização da página ÷ cliques) < 70%: página lenta ou link quebrado.",
      "Muito início de checkout e pouca compra: oferta, preço, confiança ou meio de pagamento (Pix gerado e não pago).",
      "CPA bom e ROAS ruim: ticket baixo — trabalhar bump/upsell, não o anúncio.",
    ],
  },
  {
    area: "Criativos",
    rules: [
      "Criativo é a principal alavanca do Meta atual: produzir de 3 a 5 conceitos NOVOS por semana para a oferta motor (conceitos diferentes, não só troca de cor).",
      "Fadiga: frequência > 2,5–3 em público frio ou CTR caindo 30% em relação ao início → substituir.",
      "Repetir o que venceu: mesmo ângulo, ganchos diferentes nos 3 primeiros segundos, outra pessoa/cenário.",
      "Formatos que costumam funcionar em infoproduto de IA: demonstração na tela (antes/depois do uso da ferramenta, sem promessa de ganho), UGC falando direto, prova social real, 'olha o que eu fiz em 5 minutos'.",
      "Vencedor só com teste estatístico contra o restante — gastar mais não prova que vende mais.",
    ],
  },
  {
    area: "Políticas e risco de conta",
    rules: [
      "Nada de promessa de renda garantida, enriquecimento rápido ou 'ganhe X por dia'. Falar de habilidade, tempo economizado e resultado do trabalho.",
      "Nunca sugerir cloaking, páginas falsas ou qualquer forma de enganar a revisão do Meta.",
      "Manter um Purchase por venda (desligar Purchase no Pix/boleto gerado) para o Meta otimizar para quem paga.",
    ],
  },
  {
    area: "Moeda",
    rules: [
      "A conta de anúncios pode estar em US$. Orçamentos são escritos NA MOEDA DA CONTA, sempre com o equivalente em R$ ao lado. Nunca escrever um valor em R$ onde vai dólar.",
      "Os limites de decisão (CPA, lucro) são em R$, porque a receita é em R$; mostrar a conversão quando ajudar.",
    ],
  },
];

export function playbookText(): string {
  return PLAYBOOK.map((p) => `## ${p.area}\n${p.rules.map((r) => `- ${r}`).join("\n")}`).join("\n\n");
}
