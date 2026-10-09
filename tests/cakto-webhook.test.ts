import { describe, expect, it } from "vitest";
import { parseCaktoWebhook } from "@/lib/integrations/cakto/parser";
import { mergeStatus, processCaktoWebhook } from "@/lib/ingest/cakto-webhook";
import { processCollect } from "@/lib/ingest/collect";
import { WS, caktoPayload, fakeSender, makeStore } from "./helpers";

const approved = (id = "ORD-1", extra: Record<string, unknown> = {}) =>
  caktoPayload("purchase_approved", {
    id, status: "paid", amount: 97, paymentMethod: "pix",
    customer: { name: "Maria Souza", email: "Maria@Email.com", phone: "(65) 99999-0000" },
    product: { id: "prod_1", name: "Curso X" }, createdAt: "2026-10-01T10:05:00Z", ...extra,
  });

describe("parser Cakto", () => {
  it("lê campos em caminhos alternativos e tracking da URL de checkout", () => {
    const p = parseCaktoWebhook(caktoPayload("purchase_approved", {
      id: "A1", baseAmount: "197,00", payment_method: "credit_card",
      checkoutUrl: "https://pay.cakto.com.br/abc?utm_campaign=C%7C120001&sck=sess_9",
      commissions: [{ type: "producer", totalAmount: 180.5 }],
    }));
    expect(p.kind).toBe("order_paid");
    expect(p.grossAmount).toBe(197);
    expect(p.netAmount).toBe(180.5);
    expect(p.paymentMethod).toBe("credit_card");
    expect(p.tracking.sck).toBe("sess_9");
    expect(p.tracking.utmCampaign).toBe("C|120001");
  });

  it("evento desconhecido gera aviso e não quebra", () => {
    const p = parseCaktoWebhook({ event: "algo_novo", data: {} });
    expect(p.kind).toBe("unknown");
    expect(p.warnings[0]).toMatch(/desconhecido/);
  });

  it("status não regride", () => {
    expect(mergeStatus("paid", "pending")).toBe("paid");
    expect(mergeStatus("pending", "paid")).toBe("paid");
    expect(mergeStatus("paid", "refunded")).toBe("refunded");
    expect(mergeStatus("refused", "paid")).toBe("paid");
  });
});

describe("webhook Cakto", () => {
  it("rejeita segredo inválido", async () => {
    const store = makeStore();
    const r = await processCaktoWebhook(store, approved("X", {}), {}, {});
    expect(r.status).toBe(200);
    const bad = await processCaktoWebhook(store, { ...approved("Y"), secret: "errado" }, {});
    expect(bad.status).toBe(401);
  });

  it("é idempotente: o mesmo evento duas vezes não duplica venda nem Purchase", async () => {
    const store = makeStore();
    const { sender, calls } = fakeSender();
    const a = await processCaktoWebhook(store, approved(), {}, { sender });
    const b = await processCaktoWebhook(store, approved(), {}, { sender });
    expect(a.body.capi).toBe("sent");
    expect(b.body.duplicate).toBe(true);
    expect(store.ws(WS).orders.size).toBe(1);
    expect(calls.length).toBe(1);
    const ev = calls[0].events[0] as { event_id: string; user_data: { em: string[]; ph: string[] }; custom_data: { value: number } };
    expect(ev.event_id).toBe("cakto_ORD-1");
    expect(ev.custom_data.value).toBe(97);
    expect(ev.user_data.em[0]).toHaveLength(64);
  });

  it("Pix gerado e depois aprovado: um pedido, um Purchase; reembolso não reenvia", async () => {
    const store = makeStore();
    const { sender, calls } = fakeSender();
    await processCaktoWebhook(store, caktoPayload("pix_gerado", { id: "P1", amount: 47, status: "waiting_payment" }), {}, { sender });
    expect(store.ws(WS).orders.get("P1")?.status).toBe("pending");
    expect(store.ws(WS).orders.get("P1")?.paymentMethod).toBe("pix");
    await processCaktoWebhook(store, caktoPayload("purchase_approved", { id: "P1", amount: 47, status: "paid" }), {}, { sender });
    await processCaktoWebhook(store, caktoPayload("refund", { id: "P1", amount: 47, status: "refunded" }), {}, { sender });
    const o = store.ws(WS).orders.get("P1")!;
    expect(o.status).toBe("refunded");
    expect(o.paidAt).not.toBeNull();
    expect(calls.length).toBe(1);
  });

  it("estima o líquido com a taxa padrão quando a Cakto não informa", async () => {
    const store = makeStore();
    await processCaktoWebhook(store, approved("N1"), {}, { sender: fakeSender().sender });
    const o = store.ws(WS).orders.get("N1")!;
    expect(o.netEstimated).toBe(true);
    expect(o.netAmount).toBeCloseTo(97 * (1 - 0.0699), 2);
  });

  it("liga a venda à sessão do script pelo sck e usa fbp/fbc no Purchase", async () => {
    const store = makeStore();
    const { sender, calls } = fakeSender();
    await processCollect(store, {
      site: "site_pub_1", event: "PageView", event_id: "pv_1", sid: "sess_abc", vid: "vis_1",
      url: "https://minhapagina.com/?utm_campaign=Camp%7C120001", utm_source: "facebook",
      utm_campaign: "Camp|120001", utm_term: "Set|120002", utm_content: "Ad|120003", fbclid: "CLK", fbp: "fb.1.1.2",
    }, { ip: "200.1.1.1", userAgent: "UA" }, { sender });
    const r = await processCaktoWebhook(store, approved("S1", { checkoutUrl: "https://pay.cakto.com.br/x?sck=sess_abc" }), {}, { sender });
    expect(r.body.attribution).toBe("checkout_param");
    const o = store.ws(WS).orders.get("S1")!;
    expect(o.adId).toBe("120003");
    const purchase = calls.at(-1)!.events[0] as { user_data: { fbp: string; fbc: string; client_ip_address: string } };
    expect(purchase.user_data.fbp).toBe("fb.1.1.2");
    expect(purchase.user_data.fbc).toMatch(/^fb\.1\.\d+\.CLK$/);
    expect(purchase.user_data.client_ip_address).toBe("200.1.1.1");
  });

  it("reprocessa um evento que falhou antes (reenvio da Cakto)", async () => {
    const store = makeStore();
    const original = store.upsertOrder.bind(store);
    let fail = true;
    store.upsertOrder = async (...args) => {
      if (fail) throw new Error("db fora");
      return original(...args);
    };
    const r1 = await processCaktoWebhook(store, approved("R1"), {}, { sender: fakeSender().sender });
    expect(r1.status).toBe(500);
    fail = false;
    const r2 = await processCaktoWebhook(store, approved("R1"), {}, { sender: fakeSender().sender });
    expect(r2.status).toBe(200);
    expect(store.ws(WS).orders.get("R1")?.status).toBe("paid");
  });
});

describe("coleta do script (deduplicação)", () => {
  it("mesmo event_id não é gravado nem enviado à CAPI duas vezes", async () => {
    const store = makeStore();
    const { sender, calls } = fakeSender();
    const payload = { site: "site_pub_1", event: "InitiateCheckout", event_id: "ic_1", sid: "sess_1", url: "https://x.com" };
    const a = await processCollect(store, payload, { ip: null, userAgent: null }, { sender });
    await a.afterResponse?.();
    const b = await processCollect(store, payload, { ip: null, userAgent: null }, { sender });
    expect(b.duplicate).toBe(true);
    expect(b.afterResponse).toBeUndefined();
    expect(calls.length).toBe(1);
    expect(store.ws(WS).events.length).toBe(1);
    expect(store.ws(WS).events[0].capiStatus).toBe("sent");
  });

  it("eventos internos não vão para a CAPI e site desconhecido é recusado", async () => {
    const store = makeStore();
    const { sender, calls } = fakeSender();
    const r = await processCollect(store, { site: "site_pub_1", event: "page_engagement", event_id: "evt_1", sid: "s1234" }, { ip: null, userAgent: null }, { sender });
    expect(r.afterResponse).toBeUndefined();
    expect(calls.length).toBe(0);
    const nf = await processCollect(store, { site: "nao_existe", event: "PageView", event_id: "evt_2", sid: "s1234" }, { ip: null, userAgent: null });
    expect(nf.status).toBe(404);
  });

  it("sem CAPI configurada: registra como skipped", async () => {
    const store = makeStore({ capi: false });
    const r = await processCollect(store, { site: "site_pub_1", event: "PageView", event_id: "pv_9", sid: "s12345" }, { ip: null, userAgent: null });
    await r.afterResponse?.();
    expect(store.ws(WS).capiLogs[0].status).toBe("skipped");
  });
});
