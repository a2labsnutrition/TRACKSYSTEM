import { normalizeContent, normalizeTheme, type PdfContent, type PdfProject, type PdfTheme, type PdfVersion } from "./types";

/**
 * Projetos de PDF (tabela pdf_projects) e versões (pdf_versions). Cada
 * salvamento é uma versão nova — dá para voltar a qualquer uma.
 * content = { chapters, note }.
 */
export interface PdfStore {
  readonly mode: "demo" | "live";
  listProjects(): Promise<PdfProject[]>;
  getProject(id: string): Promise<{ project: PdfProject; versions: PdfVersion[] } | null>;
  createProject(i: { title: string; brief: string; theme: PdfTheme; productId: string | null }): Promise<PdfProject>;
  updateProject(id: string, patch: Partial<Pick<PdfProject, "title" | "brief" | "theme" | "productId">>): Promise<void>;
  saveVersion(projectId: string, content: PdfContent, note: string | null): Promise<number>;
  setVersionPdf(projectId: string, version: number, pdfPath: string): Promise<void>;
  deleteProject(id: string): Promise<void>;
}

/** Versão mais recente (ou a pedida). */
export function pickVersion(versions: PdfVersion[], v?: number | null): PdfVersion | null {
  if (!versions.length) return null;
  if (v) {
    const found = versions.find((x) => x.version === v);
    if (found) return found;
  }
  return versions.reduce((a, b) => (b.version > a.version ? b : a));
}

const uid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export class MemoryPdfStore implements PdfStore {
  readonly mode = "demo" as const;
  projects: PdfProject[] = [];
  versions: PdfVersion[] = [];

  async listProjects() {
    return [...this.projects].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async getProject(id: string) {
    const project = this.projects.find((p) => p.id === id);
    return project ? { project, versions: this.versions.filter((v) => v.projectId === id).sort((a, b) => b.version - a.version) } : null;
  }
  async createProject(i: { title: string; brief: string; theme: PdfTheme; productId: string | null }) {
    const p: PdfProject = { ...i, theme: normalizeTheme(i.theme), id: uid(), createdAt: new Date().toISOString() };
    this.projects.push(p);
    return p;
  }
  async updateProject(id: string, patch: Partial<Pick<PdfProject, "title" | "brief" | "theme" | "productId">>) {
    const p = this.projects.find((x) => x.id === id);
    if (p) Object.assign(p, patch, patch.theme ? { theme: normalizeTheme(patch.theme) } : {});
  }
  async saveVersion(projectId: string, content: PdfContent, note: string | null) {
    const version = Math.max(0, ...this.versions.filter((v) => v.projectId === projectId).map((v) => v.version)) + 1;
    this.versions.push({ id: uid(), projectId, version, content: normalizeContent(content), note, pdfPath: null, createdAt: new Date().toISOString() });
    return version;
  }
  async setVersionPdf(projectId: string, version: number, pdfPath: string) {
    const v = this.versions.find((x) => x.projectId === projectId && x.version === version);
    if (v) v.pdfPath = pdfPath;
  }
  async deleteProject(id: string) {
    this.projects = this.projects.filter((p) => p.id !== id);
    this.versions = this.versions.filter((v) => v.projectId !== id);
  }
}
