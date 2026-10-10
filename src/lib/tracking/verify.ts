import "server-only";
import { log } from "@/lib/log";
import { lookup } from "node:dns/promises";
import { existsSync } from "node:fs";
import { isIP } from "node:net";
import { env } from "@/lib/env";

/**
 * Verificador de instalação: carrega a página do usuário e confere script,
 * Pixel, botões de checkout e problemas comuns.
 *  - modo "browser": Chromium headless (playwright-core) — vê páginas React/Lovable
 *    renderizadas no cliente e as requisições disparadas.
 *  - modo "static": só o HTML (quando não há navegador no servidor, ex.: Vercel).
 */

export type CheckStatus = "ok" | "warning" | "error";

export interface VerifyCheck {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface VerifyResult {
  url: string;
  mode: "browser" | "static";
  loadMs: number | null;
  checks: VerifyCheck[];
  checkoutButtons: Array<{ text: string; href: string | null; decorated: boolean; via: string }>;
  pixelIds: string[];
  notes: string[];
}

// ------------------------- proteção SSRF -------------------------
function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const l = ip.toLowerCase();
    return l === "::1" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l === "::" || l.startsWith("::ffff:127.") || l.startsWith("::ffff:10.") || l.startsWith("::ffff:192.168.");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error("URL inválida");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Use uma URL http(s)");
  const host = url.hostname;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Endereço local não permitido");
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (!addrs.length || addrs.some(isPrivateIp)) throw new Error("A URL aponta para um endereço privado — informe a URL pública da página");
  return url;
}

// ------------------------- análise -------------------------
interface Snapshot {
  html: string;
  trackerScripts: Array<{ src: string; site: string | null }>;
  pixelInits: string[];
  fbeventsLoads: number;
  links: Array<{ text: string; href: string; dataTrack: string | null }>;
  ctaButtons: string[];
  collectHits: number;
  pixelHits: string[];
  trackerReady: boolean;
  loadMs: number | null;
  redirectedTo: string | null;
}

const CHECKOUT_HOST = /(^|\.)cakto\.com(\.br)?$/i;
const CTA_WORDS = /comprar|quero|garantir|inscrev|matricul|acessar agora|pagar|adquir|checkout/i;

function hostOf(href: string, base: string) {
  try {
    return new URL(href, base).hostname;
  } catch {
    return "";
  }
}

function analyze(url: string, snap: Snapshot, siteKey: string, expectedPixel: string | null, mode: "browser" | "static"): VerifyResult {
  const checks: VerifyCheck[] = [];
  const notes: string[] = [];
  const ours = snap.trackerScripts;
  const mine = ours.filter((s) => s.site === siteKey);

  if (!ours.length) {
    checks.push({ key: "script", label: "Script de tracking", status: "error", detail: "Não encontrado. Cole o snippet no <head> da página e publique de novo." });
  } else if (!mine.length) {
    checks.push({ key: "script", label: "Script de tracking", status: "error", detail: `Script encontrado, mas com outro data-site (${ours.map((s) => s.site ?? "vazio").join(", ")}). Copie o snippet deste site.` });
  } else if (ours.length > 1) {
    checks.push({ key: "script", label: "Script de tracking", status: "warning", detail: `Script incluído ${ours.length} vezes. Deixe só uma cópia (eventos não duplicam, mas é sinal de bagunça no <head>).` });
  } else {
    checks.push({ key: "script", label: "Script de tracking", status: "ok", detail: "Instalado com o ID correto." });
  }

  if (mode === "browser") {
    checks.push(
      snap.collectHits > 0
        ? { key: "events", label: "Eventos chegando", status: "ok", detail: `${snap.collectHits} evento(s) enviados ao carregar a página.` }
        : { key: "events", label: "Eventos chegando", status: mine.length ? "warning" : "error", detail: "Nenhum evento enviado durante o teste. Se usa consentimento obrigatório, aceite os cookies na página e teste de novo." },
    );
  }

  const pixelIds = [...new Set([...snap.pixelInits, ...snap.pixelHits])];
  if (snap.fbeventsLoads > 1 || snap.pixelInits.length > new Set(snap.pixelInits).size) {
    checks.push({ key: "pixel", label: "Pixel do Meta", status: "warning", detail: "Pixel carregado/inicializado mais de uma vez. Remova o código base duplicado — o script já gerencia o Pixel." });
  } else if (!pixelIds.length && !expectedPixel) {
    checks.push({ key: "pixel", label: "Pixel do Meta", status: "warning", detail: "Nenhum Pixel detectado nem configurado. Informe o Pixel ID em Conexões → Meta para o script carregá-lo." });
  } else if (expectedPixel && pixelIds.length && !pixelIds.includes(expectedPixel)) {
    checks.push({ key: "pixel", label: "Pixel do Meta", status: "error", detail: `A página usa o Pixel ${pixelIds.join(", ")}, mas o configurado é ${expectedPixel}.` });
  } else if (mode === "browser" && expectedPixel && !snap.pixelHits.length) {
    checks.push({ key: "pixel", label: "Pixel do Meta", status: "warning", detail: "Pixel configurado, mas nenhum disparo para facebook.com/tr foi visto (bloqueador? consentimento?)." });
  } else {
    checks.push({ key: "pixel", label: "Pixel do Meta", status: "ok", detail: pixelIds.length ? `Pixel ${pixelIds.join(", ")} ativo.` : `Pixel ${expectedPixel} será carregado pelo script.` });
  }
  if (snap.pixelInits.length && mine.length) {
    notes.push("A página tem código base do Pixel próprio. O script envia PageView pela CAPI só quando gerencia o Pixel; para deduplicação completa, remova o código base e deixe o script carregar o Pixel.");
  }

  const buttons: VerifyResult["checkoutButtons"] = [];
  for (const l of snap.links) {
    const isCakto = CHECKOUT_HOST.test(hostOf(l.href, url));
    if (isCakto || l.dataTrack === "checkout") {
      let decorated = false;
      try {
        decorated = new URL(l.href, url).searchParams.has("sck");
      } catch {
        /* ignora */
      }
      buttons.push({ text: l.text.slice(0, 80) || "(sem texto)", href: l.href, decorated, via: isCakto ? "link Cakto" : 'data-track="checkout"' });
    }
  }
  if (!buttons.length) {
    checks.push({
      key: "checkout",
      label: "Botões de checkout",
      status: "error",
      detail: snap.ctaButtons.length
        ? `Nenhum link para a Cakto encontrado, mas há botões como "${snap.ctaButtons.slice(0, 2).join('", "')}". Use <a href="link da Cakto"> ou marque com data-track="checkout" / seletor CSS.`
        : "Nenhum botão/link de checkout encontrado na página.",
    });
  } else {
    const notDecorated = buttons.filter((b) => !b.decorated).length;
    checks.push({
      key: "checkout",
      label: "Botões de checkout",
      status: mode === "browser" && notDecorated && mine.length ? "warning" : "ok",
      detail:
        mode === "browser" && notDecorated && mine.length
          ? `${buttons.length} encontrado(s); ${notDecorated} ainda sem o parâmetro de sessão (podem ser decorados no clique).`
          : `${buttons.length} botão(ões) de checkout encontrados.`,
    });
  }

  if (snap.redirectedTo && new URL(snap.redirectedTo).hostname !== new URL(url).hostname) {
    checks.push({ key: "redirect", label: "Redirecionamento", status: "warning", detail: `A página redireciona para ${snap.redirectedTo}. Redirecionamentos podem perder UTMs/fbclid.` });
  }
  if (snap.loadMs != null) {
    const s = snap.loadMs / 1000;
    checks.push({
      key: "speed",
      label: "Velocidade",
      status: s > 6 ? "error" : s > 3 ? "warning" : "ok",
      detail: `Carregou em ${s.toFixed(1)} s (${mode === "browser" ? "navegador headless" : "só HTML"}). Acima de 3 s o connect rate costuma cair.`,
    });
  }
  if (mode === "static") notes.push("Teste feito só com o HTML (sem navegador no servidor). Páginas React/Lovable montam botões no navegador: confira também o painel de eventos ao vivo.");

  return { url, mode, loadMs: snap.loadMs, checks, checkoutButtons: buttons, pixelIds, notes };
}

function staticSnapshot(html: string, loadMs: number, redirectedTo: string | null): Snapshot {
  const trackerScripts = [...html.matchAll(/<script[^>]*src=["'][^"']*\/t\.js[^"']*["'][^>]*>/gi)].map((m) => ({
    src: m[0],
    site: /data-site=["']([^"']+)["']/i.exec(m[0])?.[1] ?? null,
  }));
  const pixelInits = [...html.matchAll(/fbq\(\s*['"]init['"]\s*,\s*['"]?(\d{6,})/g)].map((m) => m[1]);
  const fbeventsLoads = (html.match(/connect\.facebook\.net\/[^"']*fbevents\.js/g) ?? []).length;
  const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => ({
    href: /href=["']([^"']+)["']/i.exec(m[1])?.[1] ?? "",
    dataTrack: /data-track=["']([^"']+)["']/i.exec(m[1])?.[1] ?? null,
    text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  }));
  const ctaButtons = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .filter((t) => CTA_WORDS.test(t));
  return { html, trackerScripts, pixelInits, fbeventsLoads, links, ctaButtons, collectHits: 0, pixelHits: [], trackerReady: false, loadMs, redirectedTo };
}

function chromiumPath(): string | null {
  const candidates = [env.chromiumPath, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
}

async function browserSnapshot(url: string, exe: string): Promise<Snapshot> {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 CentralComandoVerifier",
      viewport: { width: 390, height: 844 },
    });
    // Bloqueia requisições a endereços locais/privados (SSRF via redirecionamento ou recursos da página)
    await page.route("**/*", (route) => {
      const h = new URL(route.request().url()).hostname;
      if (h === "localhost" || (isIP(h) && isPrivateIp(h))) return route.abort();
      return route.continue();
    });
    let collectHits = 0;
    const pixelHits: string[] = [];
    page.on("request", (r) => {
      const u = r.url();
      if (u.includes("/api/collect")) collectHits++;
      if (/facebook\.com\/tr/.test(u)) {
        const id = new URL(u).searchParams.get("id");
        if (id) pixelHits.push(id);
      }
    });
    const t0 = Date.now();
    const resp = await page.goto(url, { waitUntil: "load", timeout: 25_000 });
    const loadMs = Date.now() - t0;
    await page.waitForTimeout(3500);
    const data = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll("script"));
      const trackerScripts = scripts
        .filter((s) => /\/t\.js(\?|$)/.test(s.getAttribute("src") ?? ""))
        .map((s) => ({ src: s.getAttribute("src") ?? "", site: s.getAttribute("data-site") }));
      const inline = scripts.map((s) => s.textContent ?? "").join("\n");
      const pixelInits = Array.from(inline.matchAll(/fbq\(\s*['"]init['"]\s*,\s*['"]?(\d{6,})/g)).map((m) => m[1]);
      const fbeventsLoads = scripts.filter((s) => /fbevents\.js/.test(s.getAttribute("src") ?? "")).length;
      const links = Array.from(document.querySelectorAll("a[href]")).map((a) => ({
        href: (a as HTMLAnchorElement).href,
        text: (a.textContent ?? "").replace(/\s+/g, " ").trim(),
        dataTrack: a.getAttribute("data-track"),
      }));
      const ctaButtons = Array.from(document.querySelectorAll("button,[role=button]"))
        .map((b) => (b.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter((t) => /comprar|quero|garantir|inscrev|matricul|acessar agora|pagar|adquir|checkout/i.test(t));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { trackerScripts, pixelInits, fbeventsLoads, links, ctaButtons, trackerReady: Boolean((window as any).CentralTracker) };
    });
    const finalUrl = page.url();
    return {
      html: "",
      ...data,
      collectHits,
      pixelHits,
      loadMs,
      redirectedTo: resp && finalUrl !== url ? finalUrl : null,
    };
  } finally {
    await browser.close();
  }
}

export async function verifyInstallation(rawUrl: string, siteKey: string, expectedPixel: string | null): Promise<VerifyResult> {
  const url = (await assertPublicUrl(rawUrl)).toString();
  const exe = chromiumPath();
  if (exe) {
    try {
      return analyze(url, await browserSnapshot(url, exe), siteKey, expectedPixel, "browser");
    } catch (e) {
      // cai para o modo estático
      log.warn("verify.browser_failed", { error: e });
    }
  }
  const t0 = Date.now();
  // Segue redirecionamentos manualmente, validando cada destino.
  let current = url;
  let res: Response | null = null;
  for (let i = 0; i < 5; i++) {
    res = await fetch(current, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 CentralComandoVerifier" }, signal: AbortSignal.timeout(15_000) });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      current = (await assertPublicUrl(new URL(loc, current).toString())).toString();
      continue;
    }
    break;
  }
  const html = (await res!.text()).slice(0, 2_000_000);
  return analyze(url, staticSnapshot(html, Date.now() - t0, current !== url ? current : null), siteKey, expectedPixel, "static");
}

/** Exportado para testes. */
export const __test = { analyze, staticSnapshot, isPrivateIp };
