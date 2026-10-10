import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** supabase/setup_completo.sql = as três migrações, na ordem (para colar de uma vez no SQL Editor). */
describe("setup_completo.sql", () => {
  it("está em dia com as migrações", () => {
    const dir = join(process.cwd(), "supabase");
    const migrations = ["0001_init.sql", "0002_fase2.sql", "0003_confiabilidade.sql"].map((f) => readFileSync(join(dir, "migrations", f), "utf8")).join("");
    const setup = readFileSync(join(dir, "setup_completo.sql"), "utf8");
    expect(setup.endsWith(migrations)).toBe(true);
  });
});
