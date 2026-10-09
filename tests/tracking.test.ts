import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { trackerSource } from "@/lib/tracking/script";
import { __test } from "@/lib/tracking/verify";

describe("script de tracking", () => {
  it("é JavaScript válido e embute o endpoint", () => {
    const src = trackerSource("https://app.exemplo.com");
    expect(() => new Function(src)).not.toThrow();
    expect(src).toContain('"https://app.exemplo.com"');
    expect(src).toContain("trackSingle");
  });
});

describe("verificador de instalação (HTML)", () => {
  const html = `<html><head>
    <script src="https://app.exemplo.com/t.js" data-site="s_abc" async></script>
    <script>fbq('init', '123456789');fbq('track','PageView');</script>
    <script src="https://connect.facebook.net/en_US/fbevents.js"></script>
  </head><body>
    <a href="https://pay.cakto.com.br/xyz">Quero comprar</a>
    <button>Garantir minha vaga</button>
  </body></html>`;

  it("encontra script, pixel e botão de checkout", () => {
    const snap = __test.staticSnapshot(html, 900, null);
    const r = __test.analyze("https://pagina.com", snap, "s_abc", "123456789", "static");
    const byKey = Object.fromEntries(r.checks.map((c) => [c.key, c.status]));
    expect(byKey.script).toBe("ok");
    expect(byKey.pixel).toBe("ok");
    expect(byKey.checkout).toBe("ok");
    expect(r.checkoutButtons[0].text).toBe("Quero comprar");
  });

  it("aponta data-site errado, pixel divergente e falta de checkout", () => {
    const snap = __test.staticSnapshot(html.replace('href="https://pay.cakto.com.br/xyz"', 'href="#"'), 7000, null);
    const r = __test.analyze("https://pagina.com", snap, "s_outro", "999999999", "static");
    const byKey = Object.fromEntries(r.checks.map((c) => [c.key, c.status]));
    expect(byKey.script).toBe("error");
    expect(byKey.pixel).toBe("error");
    expect(byKey.checkout).toBe("error");
    expect(byKey.speed).toBe("error");
  });

  it("bloqueia IPs privados (SSRF)", () => {
    expect(__test.isPrivateIp("10.0.0.1")).toBe(true);
    expect(__test.isPrivateIp("192.168.1.10")).toBe(true);
    expect(__test.isPrivateIp("127.0.0.1")).toBe(true);
    expect(__test.isPrivateIp("8.8.8.8")).toBe(false);
  });
});
