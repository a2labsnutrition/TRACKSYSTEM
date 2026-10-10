import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PdfStore } from "./store";
import { normalizeContent, normalizeTheme, type PdfContent, type PdfProject, type PdfTheme, type PdfVersion } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

const projectFromRow = (r: any): PdfProject => ({
  id: r.id,
  title: r.title,
  brief: r.brief ?? "",
  theme: normalizeTheme(r.theme),
  productId: r.product_id ?? null,
  createdAt: r.created_at,
});

const versionFromRow = (r: any): PdfVersion => ({
  id: r.id,
  projectId: r.project_id,
  version: r.version,
  content: normalizeContent(r.content),
  note: r.content?.note ?? null,
  pdfPath: r.pdf_path ?? null,
  createdAt: r.created_at,
});

export class SupabasePdfStore implements PdfStore {
  readonly mode = "live" as const;
  constructor(
    private db: SupabaseClient,
    private ws: string,
  ) {}

  async listProjects() {
    const res = await this.db.from("pdf_projects").select("*").eq("workspace_id", this.ws).order("created_at", { ascending: false });
    return (check(res, "listar PDFs") ?? []).map(projectFromRow);
  }

  async getProject(id: string) {
    const [p, v] = await Promise.all([
      this.db.from("pdf_projects").select("*").eq("workspace_id", this.ws).eq("id", id).maybeSingle(),
      this.db.from("pdf_versions").select("*").eq("workspace_id", this.ws).eq("project_id", id).order("version", { ascending: false }),
    ]);
    const row = check(p, "ler PDF");
    if (!row) return null;
    return { project: projectFromRow(row), versions: (check(v, "ler versões") ?? []).map(versionFromRow) };
  }

  async createProject(i: { title: string; brief: string; theme: PdfTheme; productId: string | null }) {
    const res = await this.db
      .from("pdf_projects")
      .insert({ workspace_id: this.ws, title: i.title, brief: i.brief, theme: normalizeTheme(i.theme), product_id: i.productId })
      .select("*")
      .single();
    return projectFromRow(check(res, "criar PDF"));
  }

  async updateProject(id: string, patch: Partial<Pick<PdfProject, "title" | "brief" | "theme" | "productId">>) {
    const row: Record<string, unknown> = {};
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.brief !== undefined) row.brief = patch.brief;
    if (patch.theme !== undefined) row.theme = normalizeTheme(patch.theme);
    if (patch.productId !== undefined) row.product_id = patch.productId;
    check(await this.db.from("pdf_projects").update(row).eq("workspace_id", this.ws).eq("id", id), "salvar PDF");
  }

  async saveVersion(projectId: string, content: PdfContent, note: string | null) {
    const { data: prev } = await this.db.from("pdf_versions").select("version").eq("workspace_id", this.ws).eq("project_id", projectId).order("version", { ascending: false }).limit(1);
    const version = ((prev?.[0] as any)?.version ?? 0) + 1;
    check(
      await this.db.from("pdf_versions").insert({ workspace_id: this.ws, project_id: projectId, version, content: { ...normalizeContent(content), note } }),
      "salvar versão",
    );
    return version;
  }

  async setVersionPdf(projectId: string, version: number, pdfPath: string) {
    check(await this.db.from("pdf_versions").update({ pdf_path: pdfPath }).eq("workspace_id", this.ws).eq("project_id", projectId).eq("version", version), "registrar PDF");
  }

  async deleteProject(id: string) {
    check(await this.db.from("pdf_projects").delete().eq("workspace_id", this.ws).eq("id", id), "excluir PDF");
  }
}
