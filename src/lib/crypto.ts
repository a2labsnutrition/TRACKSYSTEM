import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Criptografia de segredos (tokens Meta, segredo da Cakto, chaves de API)
 * com AES-256-GCM. Formato: v1:<iv b64>:<tag b64>:<ciphertext b64>
 */

function getKey(): Buffer {
  const raw = env.encryptionKey;
  if (!raw) throw new Error("ENCRYPTION_KEY não configurada (gere com: openssl rand -base64 32)");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY deve ter 32 bytes em base64");
  return key;
}

export function encryptSecret(plain: string, key: Buffer = getKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(payload: string, key: Buffer = getKey()): string {
  const [v, ivB64, tagB64, dataB64] = payload.split(":");
  if (v !== "v1" || !ivB64 || !tagB64 || !dataB64) throw new Error("Segredo criptografado em formato inválido");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ---------- Normalização + hash para a API de Conversões do Meta ----------
// Regras: minúsculas, sem espaços; telefone só dígitos com DDI (55 para BR).

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return e.includes("@") ? e : null;
}

export function normalizePhone(phone: string | null | undefined, defaultCountry = "55"): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  digits = digits.replace(/^0+/, "");
  // Número brasileiro sem DDI: 10 ou 11 dígitos (DDD + número)
  if (defaultCountry === "55" && (digits.length === 10 || digits.length === 11)) digits = `55${digits}`;
  return digits.length >= 8 ? digits : null;
}

export function normalizeName(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");
  return n || null;
}

export function hashEmail(email: string | null | undefined): string | null {
  const n = normalizeEmail(email);
  return n ? sha256(n) : null;
}

export function hashPhone(phone: string | null | undefined): string | null {
  const n = normalizePhone(phone);
  return n ? sha256(n) : null;
}

export function hashName(name: string | null | undefined): string | null {
  const n = normalizeName(name);
  return n ? sha256(n) : null;
}

export function splitName(full: string | null | undefined): { first: string | null; last: string | null } {
  if (!full) return { first: null, last: null };
  const parts = full.trim().split(/\s+/);
  return { first: parts[0] ?? null, last: parts.length > 1 ? parts[parts.length - 1] : null };
}
