import "server-only";
import type { NotifySettings } from "@/lib/data/types";
import type { AlertCandidate } from "./engine";

/**
 * Canais de notificação.
 *  - E-mail via Resend (RESEND_API_KEY + ALERTS_FROM_EMAIL)
 *  - Telegram via bot (TELEGRAM_BOT_TOKEN + chat id configurado no workspace)
 * WhatsApp exige a API oficial do WhatsApp Business (aprovação da Meta) — não
 * incluído; use o Telegram como alternativa no celular.
 */

export interface NotifyResult {
  channel: "email" | "telegram";
  ok: boolean;
  detail: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function notifyChannelsAvailable() {
  return {
    email: Boolean(process.env.RESEND_API_KEY && process.env.ALERTS_FROM_EMAIL),
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN),
  };
}

export async function sendEmail(to: string[], subject: string, html: string, fetchImpl: typeof fetch = fetch): Promise<NotifyResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.ALERTS_FROM_EMAIL;
  if (!key || !from) return { channel: "email", ok: false, detail: "RESEND_API_KEY/ALERTS_FROM_EMAIL não configurados" };
  if (!to.length) return { channel: "email", ok: false, detail: "Nenhum e-mail cadastrado" };
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  return { channel: "email", ok: res.ok, detail: res.ok ? "enviado" : `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
}

export async function sendTelegram(chatId: string, text: string, fetchImpl: typeof fetch = fetch): Promise<NotifyResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { channel: "telegram", ok: false, detail: "TELEGRAM_BOT_TOKEN não configurado" };
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  return { channel: "telegram", ok: res.ok, detail: res.ok ? "enviado" : `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
}

const ICON = { critico: "🔴", atencao: "🟠", info: "🔵" } as const;

export async function notifyAlerts(settings: NotifySettings, alerts: AlertCandidate[], appUrl: string, workspaceName: string): Promise<NotifyResult[]> {
  if (!alerts.length) return [];
  const results: NotifyResult[] = [];
  const subject = `${alerts.some((a) => a.severity === "critico") ? "🔴" : "🟠"} ${alerts.length} alerta(s) — ${workspaceName}`;
  if (settings.emails.length) {
    const html = `<div style="font-family:system-ui,sans-serif;font-size:14px">
      <h2 style="margin:0 0 12px">${esc(workspaceName)}: ${alerts.length} alerta(s)</h2>
      ${alerts
        .map(
          (a) => `<div style="margin:0 0 12px;padding:10px;border-left:4px solid ${a.severity === "critico" ? "#ef4444" : "#f59e0b"};background:#f8fafc">
          <b>${esc(a.title)}</b><br><span>${esc(a.message)}</span>
          ${a.href ? `<br><a href="${appUrl}${a.href}">Abrir no painel</a>` : ""}
        </div>`,
        )
        .join("")}
      <p style="color:#64748b;font-size:12px">Central de Comando · ajuste as notificações em ${appUrl}/alertas</p></div>`;
    results.push(await sendEmail(settings.emails, subject, html));
  }
  if (settings.telegramChatId) {
    const text = [`<b>${esc(workspaceName)}</b> — ${alerts.length} alerta(s)`, ...alerts.map((a) => `${ICON[a.severity]} <b>${esc(a.title)}</b>\n${esc(a.message)}${a.href ? `\n${appUrl}${a.href}` : ""}`)].join("\n\n");
    results.push(await sendTelegram(settings.telegramChatId, text.slice(0, 4000)));
  }
  return results;
}
