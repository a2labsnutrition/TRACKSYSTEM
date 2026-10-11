import type { ParecerContent } from "@/lib/advisor/schema";
import { configFromProduct, type DecisionStatus } from "@/lib/decision/rules";
import { cpaInterval } from "@/lib/stats/core";
import { addDays, dateIn } from "@/lib/tz";
import { orderParts, type AdvisorReport, type Product } from "../types";
import type { DemoData } from "./generator";

/**
 * Pareceres de EXEMPLO do modo demo, datados no passado, para a tela
 * "Acerto dos pareceres" ter o que comparar. O veredito usa uma versão
 * simplificada das regras sobre os 7 dias anteriores à data do parecer.
 * Nada disso existe no modo real.
 */

const DAYS_AGO = [14, 7];

function demoStatus(spend: number, purchases: number, maxCpa: number, kill: number): DecisionStatus {
  if (spend < maxCpa) return "aguardar";
  if (purchases === 0) return spend >= maxCpa * kill ? "pausar" : "aguardar";
  const ci = cpaInterval(spend, purchases);
  if (ci.lower != null && ci.lower > maxCpa) return "pausar";
  if (ci.upper != null && ci.upper <= maxCpa && purchases >= 5) return "escalar";
  return (ci.point ?? Infinity) <= maxCpa ? "manter" : "otimizar";
}

function content(status: DecisionStatus, spend: number, purchases: number, maxCpa: number): ParecerContent {
  const cpa = purchases > 0 ? `CPA de R$ ${(spend / purchases).toFixed(2).replace(".", ",")}` : "nenhuma venda";
  return {
    veredito: {
      status,
      confianca: "moderada",
      justificativa: `Parecer de exemplo (modo demo): nos 7 dias anteriores, R$ ${spend.toFixed(2).replace(".", ",")} gastos e ${cpa}, contra um CPA máximo de R$ ${maxCpa.toFixed(2).replace(".", ",")}.`,
      concorda_com_regras: true,
    },
    diagnostico: ["Parecer de exemplo gerado automaticamente no modo demo.", `Gasto de 7 dias: R$ ${spend.toFixed(2).replace(".", ",")}.`, `Vendas principais com origem: ${purchases}.`],
    gargalo: { area: "nenhum", explicacao: "Exemplo do modo demo." },
    plano: [{ quando: "Próximos 7 dias", acao: "Acompanhar CPA e vendas diariamente.", condicao: null }],
    testes: [],
    riscos: ["Exemplo do modo demo: não use para decidir."],
    nao_mexer: ["Exemplo do modo demo."],
    caminhos: [{ nome: "Exemplo", descricao: "Parecer de exemplo do modo demo.", pros: [], contras: [] }],
    proximos_criativos: [],
    alerta_tracking: null,
    o_que_nao_sabemos: ["Este é um parecer de exemplo do modo demo, não uma análise real."],
    o_que_mudaria_a_decisao: [],
  };
}

export function seedDemoReports(d: DemoData, products: Product[], today: string, tz: string, ws: { taxRate: number; defaultFeeRate: number }): AdvisorReport[] {
  const out: AdvisorReport[] = [];
  for (const c of d.campaigns) {
    const product = products.find((p) => p.id === c.productId) ?? null;
    const cfg = product ? configFromProduct(product, ws) : configFromProduct({ netPerSale: null, targetCpa: null, maxCpa: null, minRoas: null });
    for (const ago of DAYS_AGO) {
      const reportDate = addDays(today, -ago);
      const from = addDays(reportDate, -6);
      const spend = d.insights.filter((r) => r.level === "campaign" && r.entityId === c.id && r.date >= from && r.date <= reportDate).reduce((s, r) => s + r.spend, 0);
      if (spend <= 0) continue;
      const purchases = d.orders.filter((o) => {
        if (o.campaignId !== c.id || o.status !== "paid" || orderParts(o).kind !== "main") return false;
        const day = dateIn(new Date(o.paidAt ?? o.createdAt), tz);
        return day >= from && day <= reportDate;
      }).length;
      const status = demoStatus(spend, purchases, cfg.maxCpa, cfg.killSpendMultiple);
      out.push({
        id: `demo-${c.id}-${ago}`,
        campaignId: c.id,
        reportDate,
        createdAt: `${reportDate}T21:00:00.000Z`,
        status,
        rulesStatus: status,
        confidence: "moderada",
        model: "regras (exemplo do demo)",
        content: content(status, spend, purchases, cfg.maxCpa),
        targets: { maxCpa: cfg.maxCpa, killSpendMultiple: cfg.killSpendMultiple },
      });
    }
  }
  return out;
}
