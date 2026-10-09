import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, hashEmail, normalizePhone, sha256 } from "@/lib/crypto";
import { parseInsight } from "@/lib/integrations/meta/insights";
import { resolvePeriod } from "@/lib/tz";

describe("criptografia e normalização", () => {
  it("criptografa e descriptografa (AES-256-GCM)", () => {
    const key = randomBytes(32);
    const enc = encryptSecret("EAAB-token", key);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain("EAAB");
    expect(decryptSecret(enc, key)).toBe("EAAB-token");
    expect(() => decryptSecret(enc, randomBytes(32))).toThrow();
  });

  it("normaliza para a CAPI", () => {
    expect(hashEmail("  Foo@Bar.com ")).toBe(sha256("foo@bar.com"));
    expect(normalizePhone("(65) 99999-0000")).toBe("5565999990000");
    expect(normalizePhone("+55 65 99999-0000")).toBe("5565999990000");
  });
});

describe("parser de insights do Meta", () => {
  it("lê actions com aliases", () => {
    const r = parseInsight({
      date_start: "2026-10-01", campaign_id: "1", spend: "10.50", impressions: "1000", inline_link_clicks: "30",
      actions: [
        { action_type: "landing_page_view", value: "25" },
        { action_type: "omni_initiated_checkout", value: "4" },
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "2" },
        { action_type: "video_view", value: "300" },
      ],
      action_values: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "194" }],
      video_thruplay_watched_actions: [{ action_type: "video_view", value: "80" }],
    }, "campaign");
    expect(r.spend).toBe(10.5);
    expect(r.landingPageViews).toBe(25);
    expect(r.initiateCheckout).toBe(4);
    expect(r.purchases).toBe(2);
    expect(r.purchaseValue).toBe(194);
    expect(r.video3s).toBe(300);
    expect(r.thruplay).toBe(80);
  });
});

describe("períodos", () => {
  it("resolve 7d e período anterior no fuso", () => {
    const p = resolvePeriod("America/Cuiaba", "7d", undefined, undefined, new Date("2026-10-09T02:00:00Z"));
    // 02:00 UTC = 22:00 do dia 08 em Cuiabá (UTC-4)
    expect(p.to).toBe("2026-10-08");
    expect(p.from).toBe("2026-10-02");
    expect(p.prevTo).toBe("2026-10-01");
    expect(p.prevFrom).toBe("2026-09-25");
  });
});
