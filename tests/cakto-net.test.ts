import { describe, expect, it } from "vitest";
import { parseCaktoWebhook } from "@/lib/integrations/cakto/parser";

// Formato do pedido da API da Cakto (exemplo da documentação: amount 34,35, fees 1,52, comissões 50/50)
const order = (commissions: unknown[]) => ({
  event: "purchase_approved",
  data: { id: "ord-1", status: "paid", amount: "34.35", baseAmount: "33.00", fees: "1.52", commissions },
});

describe("líquido do pedido Cakto", () => {
  it("usa o commissionValue do produtor (o que a Cakto mostra como líquido), não amount − fees", () => {
    const p = parseCaktoWebhook(
      order([
        { userId: "1", type: "producer", commissionPercentage: 50, commissionValue: 15.41 },
        { userId: "2", type: "coproducer", commissionPercentage: 50, commissionValue: 15.42 },
      ]),
    );
    expect(p.netAmount).toBe(15.41);
  });

  it("não confunde coprodutor com produtor mesmo se ele vier primeiro", () => {
    const p = parseCaktoWebhook(
      order([
        { userId: "2", type: "coproducer", commissionPercentage: 30, commissionValue: 9.85 },
        { userId: "1", type: "producer", commissionPercentage: 70, commissionValue: 22.98 },
      ]),
    );
    expect(p.netAmount).toBe(22.98);
  });

  it("sem comissões, cai para amount − fees", () => {
    expect(parseCaktoWebhook(order([])).netAmount).toBeCloseTo(32.83, 2);
  });

  it("líquido corrigido gera nova chave de idempotência (reprocessa o mesmo pedido)", () => {
    const a = parseCaktoWebhook(order([{ type: "producer", commissionValue: 15.41, commissionPercentage: 100, userId: "1" }]));
    const b = parseCaktoWebhook(order([]));
    expect(a.dedupeKey).not.toBe(b.dedupeKey);
  });
});
