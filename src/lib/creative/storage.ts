import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { MAX_UPLOAD_MB } from "./flow";

/**
 * Supabase Storage para criativos e PDFs. Bucket PRIVADO criado pelo servidor
 * na primeira vez (sem SQL manual). O navegador envia o arquivo direto ao
 * Storage com uma URL assinada de uso único (não passa pela Vercel, que limita
 * o tamanho do corpo). Leitura por URL assinada de curta duração.
 */

export const CREATIVE_BUCKET = "criativos";
export const PDF_BUCKET = "pdfs";

const ensured = new Set<string>();

export async function ensureBucket(name: string, opts: { mime: string[]; maxMb: number }): Promise<void> {
  if (ensured.has(name)) return;
  const sb = supabaseAdmin();
  const got = await sb.storage.getBucket(name);
  if (!got.data) {
    const res = await sb.storage.createBucket(name, { public: false, fileSizeLimit: opts.maxMb * 1024 * 1024, allowedMimeTypes: opts.mime });
    if (res.error && !/already exists/i.test(res.error.message)) throw new Error(`Não foi possível criar o bucket "${name}" no Supabase Storage: ${res.error.message}`);
  }
  ensured.add(name);
}

export async function ensureCreativeBucket() {
  await ensureBucket(CREATIVE_BUCKET, { mime: ["video/mp4", "video/quicktime", "video/webm", "image/png", "image/jpeg", "image/webp"], maxMb: MAX_UPLOAD_MB });
}

/** URL de envio de uso único para o caminho (dentro da pasta do workspace). */
export async function signedUpload(bucket: string, path: string): Promise<{ path: string; token: string }> {
  const res = await supabaseAdmin().storage.from(bucket).createSignedUploadUrl(path);
  if (res.error || !res.data) throw new Error(`Falha ao preparar o envio: ${res.error?.message ?? "sem resposta"}`);
  return { path: res.data.path, token: res.data.token };
}

export async function signedUrls(bucket: string, paths: string[], seconds = 3600): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!paths.length) return out;
  const res = await supabaseAdmin().storage.from(bucket).createSignedUrls(paths, seconds);
  for (const r of res.data ?? []) if (r.path && r.signedUrl) out.set(r.path, r.signedUrl);
  return out;
}

export async function objectExists(bucket: string, path: string): Promise<boolean> {
  const dir = path.split("/").slice(0, -1).join("/");
  const name = path.split("/").pop()!;
  const res = await supabaseAdmin().storage.from(bucket).list(dir, { search: name, limit: 1 });
  return Boolean(res.data?.some((o) => o.name === name));
}

export async function removeObject(bucket: string, path: string): Promise<void> {
  await supabaseAdmin().storage.from(bucket).remove([path]);
}
