import { describe, expect, it } from "vitest";
import { attributeOrder, attributionLevel, extractMetaId, fbclidFromFbc, type AttributionLookup, type SessionRef } from "@/lib/attribution/attribute";

const S = (id: string, p: Partial<SessionRef> = {}): SessionRef => ({
  sessionId: id, visitorId: "v", utmSource: "facebook", utmCampaign: "Camp|120001", utmContent: "Ad|120003",
  utmTerm: "Set|120002", fbclid: null, fbp: null, fbc: null, clientIp: null, userAgent: null,
  lastSeenAt: "2026-10-01T10:00:00Z", ...p,
});

function lookup(sessions: SessionRef[], clicks: SessionRef[] = []): AttributionLookup {
  return {
    sessionById: async (id) => sessions.find((s) => s.sessionId === id) ?? null,
    sessionByFbclid: async (f) => sessions.find((s) => s.fbclid === f) ?? null,
    sessionByEmailHash: async (h) => (h === "emailhash" ? sessions[0] ?? null : null),
    sessionByPhoneHash: async () => null,
    checkoutClicksBetween: async () => clicks,
  };
}

const order = {
  createdAt: "2026-10-01T10:05:00Z", sck: null, src: null, utmSource: null, utmCampaign: null, utmContent: null,
  utmTerm: null, fbclid: null, fbc: null, emailHash: null, phoneHash: null,
};

describe("atribuição", () => {
  it("extrai IDs do Meta das UTMs", () => {
    expect(extractMetaId("Black%20Friday%7C120208")).toBe("120208");
    expect(extractMetaId("120208123")).toBe("120208123");
    expect(extractMetaId("sem id")).toBeNull();
    expect(fbclidFromFbc("fb.1.1700000000000.AbC.dEf")).toBe("AbC.dEf");
  });

  it("1) parâmetro de checkout tem prioridade", async () => {
    const r = await attributeOrder({ ...order, sck: "sess1", fbclid: "x" }, lookup([S("sess1"), S("sess2", { fbclid: "x" })]));
    expect(r.method).toBe("checkout_param");
    expect(r.confidence).toBe(0.95);
    expect(r.campaignId).toBe("120001");
    expect(r.adsetId).toBe("120002");
    expect(r.adId).toBe("120003");
  });

  it("2) UTMs com IDs no próprio pedido", async () => {
    const r = await attributeOrder({ ...order, utmCampaign: "X|999999", utmContent: "Y|888888" }, lookup([]));
    expect(r.method).toBe("utm_ids");
    expect(r.adId).toBe("888888");
  });

  it("3) fbclid via fbc", async () => {
    const r = await attributeOrder({ ...order, fbc: "fb.1.123.CLICK" }, lookup([S("s3", { fbclid: "CLICK" })]));
    expect(r.method).toBe("fbclid");
  });

  it("4) e-mail com hash", async () => {
    const r = await attributeOrder({ ...order, emailHash: "emailhash" }, lookup([S("s4")]));
    expect(r.method).toBe("email_hash");
    expect(r.confidence).toBe(0.7);
  });

  it("5) janela de tempo: só atribui com um único candidato; ambíguo fica sem origem", async () => {
    const one = await attributeOrder(order, lookup([], [S("a")]));
    expect(one.method).toBe("time_window");
    expect(one.confidence).toBe(0.4);
    const many = await attributeOrder(order, lookup([], [S("a"), S("b")]));
    expect(many.method).toBe("unattributed");
    expect(many.ambiguous).toBe(2);
    expect(many.adId).toBeNull();
  });

  it("níveis de atribuição", () => {
    expect(attributionLevel("checkout_param")).toBe("confirmada");
    expect(attributionLevel("utm_ids")).toBe("confirmada");
    expect(attributionLevel("email_hash")).toBe("provavel");
    expect(attributionLevel("time_window")).toBe("provavel");
    expect(attributionLevel("unattributed")).toBe("desconhecida");
  });

  it("sem origem => não atribuída (nunca descarta)", async () => {
    const r = await attributeOrder(order, lookup([]));
    expect(r.method).toBe("unattributed");
    expect(r.confidence).toBe(0);
  });
});
