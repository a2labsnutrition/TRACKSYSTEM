import type { Order, TrackingHealth } from "@/lib/data/types";
import { orderParts } from "@/lib/data/types";
import { fmtBRL, fmtDec, fmtInt, fmtPct } from "@/lib/format";
import { binomialCdf, median, poissonCdf, robustZ } from "@/lib/stats/core";
import { addDays } from "@/lib/tz";
import { safeDiv } from "@/lib/utils";

/**
 * Detecção de anomalias. Cada verificação diz se o movimento é ANOMALIA
 * (improvável como variação normal, pelo teste indicado) ou se está dentro
 * do ruído esperado. Sem base histórica suficiente → "sem_dados" (não chuta).
 */

export type AnomalyStatus = "anomalia" | "normal" | "sem_dados";

export interface AnomalyCheck {
  code: string;
  title: string;
  status: AnomalyStatus;
  severity: "critico" | "atencao" | "info";
  detail: string;
  /** Como foi decidido (teste e limite). */
  method: string;
  evidence: Record<string, number | string | null>;
  href?: string;
}

export interface AnomalyDay {
  date: string;
  spend: number;
  impressions: number;
  linkClicks: number;
  landingPageViews: number;
  initiateCheckout: number;
  metaPurchases: number;
  metaPurchaseValue: number;
  /** Compras principais pagas (Cakto), todas as origens. */
  purchases: number;
  /** Faturamento bruto aprovado (Cakto) atribuído a anúncios do Meta. */
  attributedRevenue: number;
}

export interface AnomalyInput {
  /** Dias completos mais recentes por último (o dia atual parcial NÃO deve entrar). */
  days: AnomalyDay[];
  health: TrackingHealth;
  /** Pedidos dos últimos ~28 dias (todas as situações), para aprovação e duplicidade. */
  orders: Order[];
  /** Último dia completo (YYYY-MM-DD), no fuso da conta. */
  lastFullDay: string;
  now?: Date;
}

const P_LIMIT = 0.01;

export function detectAnomalies(i: AnomalyInput): AnomalyCheck[] {
  const now = i.now ?? new Date();
  const out: AnomalyCheck[] = [];
  const byDate = new Map(i.days.map((d) => [d.date, d]));
  const range = (from: string, to: string) => i.days.filter((d) => d.date >= from && d.date <= to);
  const sum = (ds: AnomalyDay[], k: keyof AnomalyDay) => ds.reduce((s, d) => s + Number(d[k] ?? 0), 0);
  const last = i.lastFullDay;

  // ------------------------------ CPM ------------------------------
  {
    const day = byDate.get(last);
    const base = range(addDays(last, -15), addDays(last, -1)).filter((d) => d.impressions >= 1000);
    const cpm = (d: AnomalyDay) => (d.spend / d.impressions) * 1000;
    if (!day || day.impressions < 1000 || base.length < 7) {
      out.push(noData("cpm", "Oscilação de CPM", "Precisa de 7+ dias com 1.000+ impressões para formar a base."));
    } else {
      const series = base.map(cpm);
      const z = robustZ(cpm(day), series, 0.05);
      const med = median(series)!;
      const change = (cpm(day) - med) / med;
      const isAnomaly = z != null && Math.abs(z) >= 3 && Math.abs(change) >= 0.25;
      out.push({
        code: "cpm",
        title: !isAnomaly ? "CPM" : change > 0 ? "CPM acima do normal" : "CPM abaixo do normal",
        status: isAnomaly ? "anomalia" : "normal",
        severity: isAnomaly && change > 0 ? "atencao" : "info",
        detail: isAnomaly
          ? `CPM de ${fmtBRL(cpm(day))} em ${fmtDay(last)}: ${fmtPct(Math.abs(change), 0)} ${change > 0 ? "acima" : "abaixo"} da mediana dos 14 dias anteriores (${fmtBRL(med)}).`
          : `CPM de ${fmtBRL(cpm(day))} em ${fmtDay(last)}, dentro da variação dos 14 dias anteriores (mediana ${fmtBRL(med)}).`,
        method: "z-score robusto (mediana/MAD) ≥ 3 e variação ≥ 25%",
        evidence: { cpm: round(cpm(day)), medianBase: round(med), z: z == null ? null : round(z) },
      });
    }
  }

  // ------------------------- conversão / CPA -------------------------
  {
    const recent = range(addDays(last, -2), last);
    const base = range(addDays(last, -16), addDays(last, -3));
    const kb = sum(base, "purchases");
    const sb = sum(base, "spend");
    const k3 = sum(recent, "purchases");
    const s3 = sum(recent, "spend");
    if (kb < 10 || sb <= 0 || s3 <= 0) {
      out.push(noData("conversao", "Queda de conversão / CPA em alta", "Precisa de 10+ vendas na base de 14 dias para testar."));
    } else {
      const expected = s3 * (kb / sb);
      const p = poissonCdf(k3, expected);
      const cpaBase = sb / kb;
      const cpa3 = safeDiv(s3, k3);
      const isAnomaly = p < P_LIMIT;
      out.push({
        code: "conversao",
        title: isAnomaly ? "Queda de conversão / CPA em alta" : "Conversão / CPA",
        status: isAnomaly ? "anomalia" : "normal",
        severity: isAnomaly ? "critico" : "info",
        detail: isAnomaly
          ? `${k3} venda(s) em 3 dias para ${fmtBRL(s3)} de gasto; no ritmo dos 14 dias anteriores (CPA ${fmtBRL(cpaBase)}) o esperado seria ~${fmtDec(expected, 1)}. Chance de ser oscilação normal: ${fmtPct(p, 1)}.`
          : `${k3} venda(s) em 3 dias (CPA ${fmtBRL(cpa3)}) vs. esperado ~${fmtDec(expected, 1)} pelo CPA de ${fmtBRL(cpaBase)} — dentro da variação normal.`,
        method: "Poisson: P(vendas ≤ observado | ritmo da base) < 1%",
        evidence: { purchases3d: k3, expected: round(expected), pValue: round(p, 4), cpaBase: round(cpaBase), cpa3d: cpa3 == null ? null : round(cpa3) },
        href: "/campanhas",
      });
    }
  }

  // ------------------------- página → checkout -------------------------
  {
    const recent = range(addDays(last, -2), last);
    const base = range(addDays(last, -16), addDays(last, -3));
    const nb = sum(base, "landingPageViews");
    const kb = sum(base, "initiateCheckout");
    const n3 = sum(recent, "landingPageViews");
    const k3 = sum(recent, "initiateCheckout");
    if (nb < 300 || n3 < 100 || kb === 0) {
      out.push(noData("checkout_rate", "Queda na taxa de checkout", "Precisa de 300+ visualizações de página na base e 100+ nos últimos 3 dias."));
    } else {
      const pBase = kb / nb;
      const p = binomialCdf(k3, n3, pBase);
      const rate3 = k3 / n3;
      const drop = (pBase - rate3) / pBase;
      const isAnomaly = p < P_LIMIT && drop >= 0.25;
      out.push({
        code: "checkout_rate",
        title: isAnomaly ? "Queda na taxa de checkout" : "Taxa de checkout",
        status: isAnomaly ? "anomalia" : "normal",
        severity: isAnomaly ? "atencao" : "info",
        detail: isAnomaly
          ? `Só ${fmtPct(rate3, 1)} das visitas iniciaram checkout nos últimos 3 dias vs. ${fmtPct(pBase, 1)} na base (queda de ${fmtPct(drop, 0)}). Verifique página, preço e checkout.`
          : `Taxa de início de checkout ${fmtPct(rate3, 1)} vs. ${fmtPct(pBase, 1)} na base — dentro do esperado.`,
        method: "binomial exato: P(checkouts ≤ observado | taxa da base) < 1% e queda ≥ 25% (eventos do Pixel/CAPI)",
        evidence: { rate3d: round(rate3, 4), rateBase: round(pBase, 4), pValue: round(p, 4) },
      });
    }
  }

  // ------------------------- aprovação de pagamento -------------------------
  {
    const recentFrom = addDays(last, -6);
    const baseFrom = addDays(last, -27);
    const generatedStatuses = new Set(["paid", "pending", "refused", "refunded", "chargeback", "canceled"]);
    const approvedStatuses = new Set(["paid", "refunded", "chargeback"]);
    const by = (from: string, to: string, method: string) => {
      const os = i.orders.filter((o) => {
        const d = o.createdAt.slice(0, 10);
        return d >= from && d <= to && o.paymentMethod === method && generatedStatuses.has(o.status);
      });
      return { n: os.length, k: os.filter((o) => approvedStatuses.has(o.status)).length };
    };
    for (const method of ["pix", "credit_card"] as const) {
      const label = method === "pix" ? "Pix" : "cartão";
      const r = by(recentFrom, last, method);
      const b = by(baseFrom, addDays(recentFrom, -1), method);
      if (b.n < 20 || r.n < 10) {
        out.push(noData(`aprovacao_${method}`, `Aprovação de ${label}`, `Precisa de 20+ pedidos de ${label} na base e 10+ nos últimos 7 dias.`));
        continue;
      }
      const pBase = b.k / b.n;
      const rate = r.k / r.n;
      const p = binomialCdf(r.k, r.n, pBase);
      const isAnomaly = p < P_LIMIT && pBase - rate >= 0.1;
      out.push({
        code: `aprovacao_${method}`,
        title: isAnomaly ? `Queda na aprovação de ${label}` : `Aprovação de ${label}`,
        status: isAnomaly ? "anomalia" : "normal",
        severity: isAnomaly ? "critico" : "info",
        detail: isAnomaly
          ? `Aprovação de ${label} em ${fmtPct(rate, 0)} nos últimos 7 dias vs. ${fmtPct(pBase, 0)} nas 3 semanas anteriores. Verifique a Cakto (antifraude, adquirente, expiração do Pix).`
          : `Aprovação de ${label} ${fmtPct(rate, 0)} vs. ${fmtPct(pBase, 0)} na base — dentro do esperado.`,
        method: "binomial exato: P(aprovados ≤ observado | taxa da base) < 1% e queda ≥ 10 p.p.",
        evidence: { rate7d: round(rate, 3), rateBase: round(pBase, 3), pValue: round(p, 4), orders7d: r.n },
        href: "/vendas",
      });
    }
  }

  // ------------------------- sincronização do Meta -------------------------
  {
    const at = i.health.lastMetaSyncAt ? new Date(i.health.lastMetaSyncAt) : null;
    const hours = at ? (now.getTime() - at.getTime()) / 3600000 : null;
    if (hours == null) {
      out.push({ ...noData("sync_meta", "Sincronização do Meta", "Nenhuma sincronização registrada."), status: "anomalia", severity: "atencao", href: "/conexoes" });
    } else {
      const isAnomaly = hours > 6;
      out.push({
        code: "sync_meta",
        title: isAnomaly ? "Sincronização do Meta atrasada" : "Sincronização do Meta",
        status: isAnomaly ? "anomalia" : "normal",
        severity: hours > 24 ? "critico" : isAnomaly ? "atencao" : "info",
        detail: isAnomaly
          ? `Último sync há ${fmtDec(hours, 0)} h. Os números de gasto podem estar desatualizados — não decida orçamento com eles.`
          : `Último sync há ${fmtDec(hours, 1)} h.`,
        method: "anomalia se o último sync tiver mais de 6 h (o cron roda a cada hora)",
        evidence: { hoursSinceSync: round(hours, 1) },
        href: "/conexoes",
      });
    }
  }

  // ------------------------- webhook da Cakto parado -------------------------
  {
    const recent = range(addDays(last, -1), last);
    const metaPurch = sum(recent, "metaPurchases");
    const checkouts = sum(recent, "initiateCheckout");
    const at = i.health.lastCaktoEventAt ? new Date(i.health.lastCaktoEventAt) : null;
    const hours = at ? (now.getTime() - at.getTime()) / 3600000 : null;
    const activity = metaPurch > 0 || checkouts >= 20;
    const isAnomaly = activity && (hours == null || hours > 24);
    out.push({
      code: "webhook_cakto",
      title: isAnomaly ? "Webhook da Cakto sem eventos" : "Webhook da Cakto",
      status: !activity && hours == null ? "sem_dados" : isAnomaly ? "anomalia" : "normal",
      severity: isAnomaly ? "critico" : "info",
      detail: isAnomaly
        ? `O Meta registrou ${fmtInt(metaPurch)} compra(s) e ${fmtInt(checkouts)} checkout(s) nos últimos 2 dias, mas nenhum evento da Cakto chegou ${hours == null ? "até hoje" : `há ${fmtDec(hours, 0)} h`}. Verifique o webhook (URL e segredo).`
        : hours == null
          ? "Nenhum evento da Cakto recebido ainda."
          : `Último evento da Cakto há ${fmtDec(hours, 1)} h.`,
      method: "anomalia se houver atividade no Meta (compras ou 20+ checkouts em 2 dias) e nenhum evento da Cakto em 24 h",
      evidence: { metaPurchases2d: metaPurch, checkouts2d: checkouts, hoursSinceCakto: hours == null ? null : round(hours, 1) },
      href: "/saude",
    });
  }

  // ------------------------- pedidos possivelmente duplicados -------------------------
  {
    const dups = possibleDuplicateOrders(i.orders);
    out.push({
      code: "duplicidade",
      title: dups.length ? "Pedidos possivelmente duplicados" : "Pedidos duplicados",
      status: dups.length ? "anomalia" : "normal",
      severity: dups.length ? "atencao" : "info",
      detail: dups.length
        ? `${dups.length} par(es) de pedidos pagos com o mesmo e-mail, produto e valor em menos de 15 min (IDs diferentes). Confirme na Cakto antes de contar como venda.`
        : "Nenhum par suspeito (mesmo e-mail, produto e valor em 15 min).",
      method: "heurística: mesmo e-mail + produto + valor, pagos com < 15 min de diferença e IDs diferentes (eventos repetidos com o mesmo ID já são deduplicados na entrada)",
      evidence: { pairs: dups.length, examples: dups.slice(0, 3).map((d) => d.join(" / ")).join("; ") || null },
      href: "/vendas",
    });
  }

  // ------------------------- divergência de receita Meta × Cakto -------------------------
  {
    const ds = range(addDays(last, -6), last);
    const metaRev = sum(ds, "metaPurchaseValue");
    const caktoRev = sum(ds, "attributedRevenue");
    const metaK = sum(ds, "metaPurchases");
    if (metaK + sum(ds, "purchases") < 10) {
      out.push(noData("divergencia_receita", "Divergência de receita Meta × Cakto", "Menos de 10 compras em 7 dias."));
    } else {
      const ratio = caktoRev > 0 ? (metaRev - caktoRev) / caktoRev : null;
      const isAnomaly = ratio == null || Math.abs(ratio) > 0.3;
      out.push({
        code: "divergencia_receita",
        title: isAnomaly ? "Divergência de receita Meta × Cakto" : "Receita Meta × Cakto",
        status: isAnomaly ? "anomalia" : "normal",
        severity: isAnomaly ? "atencao" : "info",
        detail: `7 dias — Meta (valor de conversão reportado): ${fmtBRL(metaRev)} · Cakto (aprovado e atribuído a anúncios): ${fmtBRL(caktoRev)}.${
          isAnomaly
            ? " Diferença acima de 30%: janelas de atribuição diferentes (o Meta conta visualização e 7 dias de clique), Pix gerado e não pago contado como compra, ou vendas sem origem identificada."
            : " Diferença dentro do normal."
        }`,
        method: "anomalia se |Meta − Cakto| ÷ Cakto > 30% com 10+ compras",
        evidence: { metaRevenue: round(metaRev), caktoAttributedRevenue: round(caktoRev), ratio: ratio == null ? null : round(ratio, 3) },
        href: "/saude",
      });
    }
  }

  // ------------------------- falhas no envio para a CAPI -------------------------
  if (i.health.capiFailed > 0) {
    out.push({
      code: "capi_falhas",
      title: "Falhas no envio para a API de Conversões",
      status: "anomalia",
      severity: "atencao",
      detail: `${fmtInt(i.health.capiFailed)} evento(s) falharam (${fmtInt(i.health.capiSent)} enviados). O cron reenvia automaticamente; se persistir, verifique o token do Pixel.`,
      method: "contagem de envios com erro",
      evidence: { failed: i.health.capiFailed, sent: i.health.capiSent },
      href: "/saude",
    });
  }

  return out.sort((a, b) => rank(a) - rank(b));
}

/** Pares de pedidos pagos que parecem a mesma compra registrada duas vezes. */
export function possibleDuplicateOrders(orders: Order[]): Array<[string, string]> {
  const paid = orders
    .filter((o) => (o.status === "paid" || o.status === "refunded") && o.customerEmail && orderParts(o).kind === "main")
    .sort((a, b) => (a.paidAt ?? a.createdAt).localeCompare(b.paidAt ?? b.createdAt));
  const pairs: Array<[string, string]> = [];
  for (let x = 0; x < paid.length; x++) {
    for (let y = x + 1; y < paid.length; y++) {
      const a = paid[x];
      const b = paid[y];
      const dt = (new Date(b.paidAt ?? b.createdAt).getTime() - new Date(a.paidAt ?? a.createdAt).getTime()) / 60000;
      if (dt > 15) break;
      if (
        a.externalId !== b.externalId &&
        a.customerEmail!.toLowerCase() === b.customerEmail!.toLowerCase() &&
        a.productId === b.productId &&
        Math.abs(a.grossAmount - b.grossAmount) < 0.01
      ) {
        pairs.push([a.externalId, b.externalId]);
      }
    }
  }
  return pairs;
}

function noData(code: string, title: string, detail: string): AnomalyCheck {
  return { code, title, status: "sem_dados", severity: "info", detail, method: "—", evidence: {} };
}

function rank(a: AnomalyCheck): number {
  const s = a.status === "anomalia" ? 0 : a.status === "normal" ? 10 : 20;
  return s + (a.severity === "critico" ? 0 : a.severity === "atencao" ? 1 : 2);
}

function round(v: number, d = 2): number {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}

function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
