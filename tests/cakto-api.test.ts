import { describe, expect, it } from "vitest";
import { caktoListOrders, caktoToken, missingScopes, nextPageUrl } from "@/lib/integrations/cakto/api";

const BASE = "https://api.cakto.com.br";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("escopos da chave da Cakto", () => {
  it("exige read e orders quando a Cakto informa o scope", () => {
    expect(missingScopes("read write products offers orders")).toEqual([]);
    expect(missingScopes("read products")).toEqual(["orders"]);
    expect(missingScopes("write orders")).toEqual(["read"]);
  });
  it("sem o campo scope, não bloqueia", () => {
    expect(missingScopes(undefined)).toEqual([]);
    expect(missingScopes("")).toEqual([]);
  });
  it("token de chave sem pedidos dá erro explicativo (antes de tentar listar)", async () => {
    const fake = (async () => json({ access_token: "tok", token_type: "Bearer", scope: "read products" })) as typeof fetch;
    await expect(caktoToken({ clientId: "id", clientSecret: "sec" }, fake)).rejects.toThrow(/escopos: orders/);
  });
});

describe("listagem de pedidos", () => {
  it("next com http:// vira https na base configurada (sem perder o caminho/página)", () => {
    expect(nextPageUrl("http://api.cakto.com.br/public_api/orders/?page=2&limit=100", BASE)).toBe(`${BASE}/public_api/orders/?page=2&limit=100`);
    expect(nextPageUrl("/public_api/orders/?page=3", BASE)).toBe(`${BASE}/public_api/orders/?page=3`);
    expect(nextPageUrl(null, BASE)).toBeNull();
    expect(nextPageUrl("https://outro-site.com/coisa", BASE)).toBeNull();
  });

  it("manda o token em todas as páginas e usa os filtros da documentação", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
      if (url.includes("page=2")) return json({ count: 3, next: null, results: [{ id: "c" }] });
      return json({ count: 3, next: "http://api.cakto.com.br/public_api/orders/?page=2", results: [{ id: "a" }, { id: "b" }] });
    }) as typeof fetch;
    const orders = await caktoListOrders("tok123", { createdFrom: "2026-10-06", createdTo: "2026-10-13" }, fake);
    expect(orders).toHaveLength(3);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.auth === "Bearer tok123")).toBe(true);
    expect(calls[1].url.startsWith("https://")).toBe(true);
    const first = new URL(calls[0].url);
    expect(first.searchParams.get("createdAt__gte")).toBe("2026-10-06");
    expect(first.searchParams.get("createdAt__lt")).toBe("2026-10-14");
    expect(first.searchParams.has("created_at__gte")).toBe(false);
  });

  it("401 explica o que conferir", async () => {
    const fake = (async () => json({ detail: "invalid token" }, 401)) as typeof fetch;
    await expect(caktoListOrders("x", {}, fake)).rejects.toThrow(/HTTP 401.*escopos/);
  });
});
