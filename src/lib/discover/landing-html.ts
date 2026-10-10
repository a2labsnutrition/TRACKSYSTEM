import type { LandingContent, OfferContent } from "./schemas";

/**
 * Exporta a página de vendas como um único arquivo HTML (CSS embutido), pronto
 * para subir em qualquer hospedagem. Botões de compra = links com
 * data-track="checkout"; o script de tracking vai no <head>.
 */

export interface LandingHtmlInput {
  landing: LandingContent;
  offer?: OfferContent | null;
  productName: string;
  checkoutUrl: string | null;
  trackingSnippet: string | null;
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function color(v: string, fallback: string): string {
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v.trim()) ? v.trim() : fallback;
}

function safeUrl(v: string | null): string {
  if (!v) return "#";
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "#";
  } catch {
    return "#";
  }
}

function inline(s: string): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>")
    .replace(/\[([A-ZÀ-Ú0-9][^\]]{2,80})\]/g, '<mark class="ph">[$1]</mark>');
}

/** Markdown simples → HTML: parágrafos, **negrito**, *itálico*, listas "- " / "1. ", títulos "#". */
export function miniMarkdown(md: string): string {
  const out: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    const ul = /^[-*•]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (!line) {
      flushPara();
      flushList();
    } else if (h) {
      flushPara();
      flushList();
      out.push(`<h3>${inline(h[2])}</h3>`);
    } else if (ul || ol) {
      flushPara();
      const tag = ul ? "ul" : "ol";
      if (!list || list.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      list.items.push((ul ?? ol)![1]);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return out.join("\n");
}

export function buildLandingHtml(i: LandingHtmlInput): string {
  const l = i.landing;
  const c = {
    p: color(l.paleta.primaria, "#2563eb"),
    bg: color(l.paleta.fundo, "#ffffff"),
    t: color(l.paleta.texto, "#111827"),
    d: color(l.paleta.destaque, "#f59e0b"),
  };
  const href = esc(safeUrl(i.checkoutUrl));
  const cta = `<p class="cta-wrap"><a class="cta" href="${href}" data-track="checkout">${esc(l.cta_texto)}</a></p>`;
  const sections = l.secoes
    .map(
      (s, idx) =>
        `<section class="s${idx % 2 ? " alt" : ""}"><div class="wrap">${idx === 0 ? `<h1>${inline(s.titulo)}</h1>` : `<h2>${inline(s.titulo)}</h2>`}\n${miniMarkdown(s.copy)}${s.tem_botao_checkout ? `\n${cta}` : ""}</div></section>`,
    )
    .join("\n");
  const faq =
    i.offer?.faq?.length && !l.secoes.some((s) => /faq|perguntas/i.test(s.titulo))
      ? `<section class="s"><div class="wrap"><h2>Perguntas frequentes</h2>${i.offer.faq
          .map((f) => `<details><summary>${inline(f.pergunta)}</summary>${miniMarkdown(f.resposta)}</details>`)
          .join("")}</div></section>`
      : "";
  const missing = i.checkoutUrl ? "" : `<!-- ATENÇÃO: troque href="#" pelo link do checkout da Cakto em todos os botões. -->\n`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(i.productName)}</title>
${i.trackingSnippet ?? "<!-- Cole aqui o script de tracking (Central → Conexões → Script) -->"}
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:${c.bg};color:${c.t};line-height:1.6;font-size:18px}
.wrap{max-width:760px;margin:0 auto;padding:48px 20px}.s.alt{background:color-mix(in srgb,${c.p} 6%,${c.bg})}
h1{font-size:2rem;line-height:1.2;margin:0 0 16px}h2{font-size:1.6rem;line-height:1.25;margin:0 0 16px;color:${c.p}}h3{font-size:1.2rem;margin:24px 0 8px}
p{margin:0 0 14px}ul,ol{padding-left:22px;margin:0 0 14px}li{margin:4px 0}strong{color:${c.p}}
.cta-wrap{text-align:center;margin:28px 0 0}.cta{display:inline-block;background:${c.d};color:#111;font-weight:700;text-decoration:none;padding:16px 28px;border-radius:10px;font-size:1.1rem;box-shadow:0 4px 14px rgba(0,0,0,.15)}
.cta:hover{filter:brightness(1.05)}mark.ph{background:#fff3c4;color:#7a5b00;padding:2px 4px;border-radius:4px}
details{border-bottom:1px solid rgba(0,0,0,.1);padding:12px 0}summary{cursor:pointer;font-weight:600}
footer{font-size:.8rem;opacity:.7;text-align:center;padding:32px 20px}
@media(min-width:768px){h1{font-size:2.6rem}}
</style>
</head>
<body>
${missing}${sections}
${faq}
<footer>${esc(i.productName)} · <a href="#">Política de Privacidade</a> · <a href="#">Termos de Uso</a><br>Este site não faz parte do Facebook ou da Meta Platforms, Inc.</footer>
</body>
</html>
`;
}
