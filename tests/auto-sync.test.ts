import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { needsAutoSync } from "@/lib/integrations/meta/auto-sync";

describe("sincronização ao abrir o painel", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  it("dispara quando alguma conta está há mais de 15 min sem sync (ou nunca sincronizou)", () => {
    expect(needsAutoSync([{ lastSyncedAt: "2026-10-10T11:40:00Z" }], now)).toBe(true);
    expect(needsAutoSync([{ lastSyncedAt: null }], now)).toBe(true);
  });
  it("não dispara com dados recentes ou sem contas", () => {
    expect(needsAutoSync([{ lastSyncedAt: "2026-10-10T11:50:00Z" }], now)).toBe(false);
    expect(needsAutoSync([], now)).toBe(false);
  });
});
