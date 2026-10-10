/**
 * Log estruturado (uma linha JSON por evento) com remoção de segredos.
 * Nunca registre tokens: chaves com nome sensível são mascaradas e padrões
 * conhecidos (token do Meta "EAA…", chaves da Anthropic, Bearer, JWT,
 * access_token= em URLs) são substituídos mesmo dentro de textos.
 */

const SENSITIVE_KEY = /token|secret|senha|password|authorization|api[_-]?key|signature|cookie|credential/i;
const PATTERNS: Array<[RegExp, string]> = [
  [/EAA[A-Za-z0-9]{20,}/g, "EAA***"],
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, "sk-ant-***"],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***"],
  [/(access_token|appsecret_proof|client_secret|secret|token)=([^&\s"']+)/gi, "$1=***"],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "jwt***"],
];

export function redactText(s: string): string {
  let out = s;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

export function redact(v: unknown, depth = 0): unknown {
  if (v == null) return v;
  if (typeof v === "string") return redactText(v);
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Error) return { name: v.name, message: redactText(v.message) };
  if (depth > 5) return "[…]";
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redact(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) && val != null && val !== "" ? "***" : redact(val, depth + 1);
    }
    return out;
  }
  return String(v);
}

type Level = "info" | "warn" | "error";

function emit(level: Level, event: string, data?: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...((redact(data ?? {}) as Record<string, unknown>) ?? {}) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, data?: Record<string, unknown>) => emit("info", event, data),
  warn: (event: string, data?: Record<string, unknown>) => emit("warn", event, data),
  error: (event: string, data?: Record<string, unknown>) => emit("error", event, data),
};
