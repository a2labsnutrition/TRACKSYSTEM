import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { parseLandingHtml } from "@/lib/creative/landing-snapshot";

describe("leitura da página de destino", () => {
  it("pega título, descrição, títulos e texto sem scripts", () => {
    const html = `<html><head><title>Fature com IA</title><meta name="description" content="Aprenda a vender serviços com IA &amp; ganhar clientes"><script>var x = "segredo";</script><style>.a{}</style></head>
      <body><h1>Seu primeiro cliente com IA</h1><p>Método em 7 dias.</p><h2>Para quem é</h2><noscript>no</noscript></body></html>`;
    const s = parseLandingHtml(html, "https://faturecomiaa.lovable.app/");
    expect(s.title).toBe("Fature com IA");
    expect(s.description).toBe("Aprenda a vender serviços com IA & ganhar clientes");
    expect(s.headings).toEqual(["Seu primeiro cliente com IA", "Para quem é"]);
    expect(s.text).toContain("Método em 7 dias");
    expect(s.text).not.toContain("segredo");
  });
});
