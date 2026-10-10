/**
 * Conteúdo dos capítulos em markdown simples → blocos. O MESMO resultado
 * alimenta a prévia na tela e o PDF (o que você vê é o que sai).
 *
 * Suportado: ## / ### títulos, parágrafos, **negrito**, *itálico*, `código`,
 * [links](https://…), listas "- " e "1. ", checklist "- [ ] " / "- [x] ",
 * tabelas com "|", destaques "> **Dica:** …", citações "> …",
 * imagens ![legenda](https://…) ou ![legenda](storage:caminho) e a linha [QUEBRA DE PÁGINA].
 */

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  href?: string;
}

export type Block =
  | { type: "heading"; level: 2 | 3 | 4; runs: Run[] }
  | { type: "paragraph"; runs: Run[] }
  | { type: "list"; ordered: boolean; items: Run[][] }
  | { type: "checklist"; items: Array<{ checked: boolean; runs: Run[] }> }
  | { type: "table"; header: Run[][]; rows: Run[][][] }
  | { type: "callout"; label: string | null; runs: Run[] }
  | { type: "quote"; runs: Run[] }
  | { type: "image"; src: string; alt: string }
  | { type: "pagebreak" };

export const PAGE_BREAK = "[QUEBRA DE PÁGINA]";

const safeHref = (u: string) => (/^(https?:|mailto:)/i.test(u.trim()) ? u.trim() : null);

/** Texto inline → trechos com estilo. */
export function parseInline(text: string): Run[] {
  const runs: Run[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])|(?<![\w_])_([^_\s][^_]*?)_(?![\w_]))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    if (m[2] !== undefined) runs.push({ text: m[2], bold: true });
    else if (m[3] !== undefined) runs.push({ text: m[3], code: true });
    else if (m[4] !== undefined) {
      const href = safeHref(m[5]);
      runs.push(href ? { text: m[4], href } : { text: m[4] });
    } else runs.push({ text: m[6] ?? m[7], italic: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.filter((r) => r.text);
}

export const runsText = (runs: Run[]) => runs.map((r) => r.text).join("");

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => parseInline(c.trim()));

export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ type: "paragraph", runs: parseInline(para.join(" ")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      flush();
      continue;
    }
    if (line === PAGE_BREAK || /^\\pagebreak$/i.test(line)) {
      flush();
      out.push({ type: "pagebreak" });
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const level = Math.min(4, Math.max(2, h[1].length)) as 2 | 3 | 4;
      out.push({ type: "heading", level, runs: parseInline(h[2]) });
      continue;
    }
    const img = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(line);
    if (img) {
      flush();
      // "storage:<caminho>" = imagem enviada ao Storage (resolvida na hora de gerar)
      const src = /^storage:[\w\-/.]+$/.test(img[2]) ? img[2] : safeHref(img[2]);
      if (src) out.push({ type: "image", src, alt: img[1] });
      continue;
    }
    if (line.startsWith(">")) {
      flush();
      const parts: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) parts.push(lines[i++].trim().replace(/^>\s?/, ""));
      i--;
      const text = parts.join(" ");
      const lab = /^\*\*([^*]{1,30}?):?\*\*:?\s*(.*)$/.exec(text);
      out.push(lab ? { type: "callout", label: lab[1].replace(/:$/, ""), runs: parseInline(lab[2]) } : { type: "quote", runs: parseInline(text) });
      continue;
    }
    if (line.startsWith("|") && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1].trim())) {
      flush();
      const header = cells(line);
      i += 2;
      const rows: Run[][][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      i--;
      out.push({ type: "table", header, rows });
      continue;
    }
    if (/^[-*]\s+\[[ xX]\]\s+/.test(line)) {
      flush();
      const items: Array<{ checked: boolean; runs: Run[] }> = [];
      while (i < lines.length && /^[-*]\s+\[[ xX]\]\s+/.test(lines[i].trim())) {
        const l = lines[i++].trim();
        items.push({ checked: /\[[xX]\]/.test(l.slice(0, 6)), runs: parseInline(l.replace(/^[-*]\s+\[[ xX]\]\s+/, "")) });
      }
      i--;
      out.push({ type: "checklist", items });
      continue;
    }
    const li = /^([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const ordered = /\d/.test(li[1]);
      const items: Run[][] = [];
      while (i < lines.length) {
        const m = /^([-*•]|\d+[.)])\s+(.*)$/.exec(lines[i].trim());
        if (!m || /\d/.test(m[1]) !== ordered || /^[-*]\s+\[[ xX]\]/.test(lines[i].trim())) break;
        items.push(parseInline(m[2]));
        i++;
      }
      i--;
      out.push({ type: "list", ordered, items });
      continue;
    }
    para.push(line);
  }
  flush();
  return out;
}

/** Contagem aproximada de páginas A4 (≈ 420 palavras por página de texto corrido). */
export function estimatePages(markdowns: string[]): number {
  const words = markdowns.join(" ").split(/\s+/).filter(Boolean).length;
  const breaks = markdowns.join("\n").split(PAGE_BREAK).length - 1;
  return Math.max(1, Math.ceil(words / 420) + breaks);
}

/** Caminhos do Storage usados em imagens (para gerar URLs assinadas antes de renderizar). */
export function storageImagePaths(markdowns: string[]): string[] {
  const out = new Set<string>();
  for (const md of markdowns) for (const m of md.matchAll(/!\[[^\]]*\]\(storage:([\w\-/.]+)\)/g)) out.add(m[1]);
  return [...out];
}

/** Troca "storage:caminho" pelas URLs assinadas (as que faltarem somem do PDF em vez de quebrar). */
export function resolveStorageImages(md: string, urls: Map<string, string>): string {
  return md.replace(/!\[([^\]]*)\]\(storage:([\w\-/.]+)\)/g, (_, alt: string, p: string) => (urls.has(p) ? `![${alt}](${urls.get(p)})` : `> **Imagem:** ${alt || p} (arquivo não encontrado)`));
}
