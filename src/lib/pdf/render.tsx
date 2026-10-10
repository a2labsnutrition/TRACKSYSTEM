import "server-only";
import path from "node:path";
import { Document, Font, Image, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { parseBlocks, type Block, type Run } from "./blocks";
import type { PdfContent, PdfProject } from "./types";

/**
 * PDF gerado no servidor (sem navegador): react-pdf com as fontes embutidas
 * (Inter e Merriweather, licença OFL, em src/lib/pdf/fonts).
 */

const FONT_DIR = path.join(process.cwd(), "src/lib/pdf/fonts");
let fontsReady = false;
function registerFonts() {
  if (fontsReady) return;
  for (const [family, file] of [
    ["Inter", "inter"],
    ["Merriweather", "merriweather"],
  ] as const) {
    Font.register({
      family,
      fonts: [
        { src: path.join(FONT_DIR, `${file}-latin-400-normal.woff`), fontWeight: 400 },
        { src: path.join(FONT_DIR, `${file}-latin-400-italic.woff`), fontWeight: 400, fontStyle: "italic" },
        { src: path.join(FONT_DIR, `${file}-latin-700-normal.woff`), fontWeight: 700 },
        { src: path.join(FONT_DIR, `${file}-latin-700-italic.woff`), fontWeight: 700, fontStyle: "italic" },
      ],
    });
  }
  // Sem hifenização automática (a padrão é para inglês).
  Font.registerHyphenationCallback((word) => [word]);
  fontsReady = true;
}

function styles(p: PdfProject) {
  const t = p.theme;
  const family = t.font === "merriweather" ? "Merriweather" : "Inter";
  return StyleSheet.create({
    page: { fontFamily: family, fontSize: 11, lineHeight: 1.55, color: "#1f2937", paddingTop: 56, paddingBottom: 56, paddingHorizontal: 56 },
    cover: { fontFamily: family, padding: 0 },
    coverBand: { backgroundColor: t.primary, height: "62%", padding: 56, justifyContent: "flex-end" },
    coverTitle: { color: "#ffffff", fontSize: 34, fontWeight: 700, lineHeight: 1.15 },
    coverSubtitle: { color: "#ffffff", fontSize: 15, marginTop: 14, opacity: 0.9 },
    coverAccent: { backgroundColor: t.accent, height: 8 },
    coverAuthor: { padding: 56, fontSize: 13, color: "#374151" },
    header: { position: "absolute", top: 24, left: 56, right: 56, fontSize: 8, color: "#9ca3af", textAlign: "right" },
    footer: { position: "absolute", bottom: 24, left: 56, right: 56, fontSize: 8, color: "#9ca3af", flexDirection: "row", justifyContent: "space-between" },
    tocTitle: { fontSize: 22, fontWeight: 700, color: t.primary, marginBottom: 18 },
    tocItem: { fontSize: 12, marginBottom: 8, color: "#1f2937", textDecoration: "none" },
    chapterKicker: { fontSize: 9, color: t.accent, fontWeight: 700, letterSpacing: 1.5, marginBottom: 4 },
    chapterTitle: { fontSize: 24, fontWeight: 700, color: t.primary, marginBottom: 16, lineHeight: 1.2 },
    h2: { fontSize: 16, fontWeight: 700, color: t.primary, marginTop: 14, marginBottom: 6 },
    h3: { fontSize: 13, fontWeight: 700, marginTop: 10, marginBottom: 4 },
    h4: { fontSize: 11.5, fontWeight: 700, marginTop: 8, marginBottom: 3 },
    p: { marginBottom: 8 },
    listRow: { flexDirection: "row", marginBottom: 4 },
    bullet: { width: 16 },
    listText: { flex: 1 },
    box: { width: 9, height: 9, borderWidth: 1, borderColor: "#6b7280", marginTop: 3, marginRight: 7 },
    callout: { backgroundColor: "#f3f4f6", borderLeftWidth: 3, borderLeftColor: t.accent, padding: 10, marginVertical: 8 },
    calloutLabel: { fontWeight: 700, color: t.primary, marginBottom: 2 },
    quote: { borderLeftWidth: 2, borderLeftColor: "#d1d5db", paddingLeft: 10, fontStyle: "italic", color: "#4b5563", marginVertical: 6 },
    table: { borderWidth: 1, borderColor: "#d1d5db", marginVertical: 8 },
    tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e5e7eb" },
    th: { flex: 1, padding: 5, fontWeight: 700, backgroundColor: "#f3f4f6", fontSize: 10 },
    td: { flex: 1, padding: 5, fontSize: 10, minHeight: 18 },
    image: { marginVertical: 8, maxHeight: 320, objectFit: "contain" },
    caption: { fontSize: 9, color: "#6b7280", textAlign: "center", marginBottom: 8 },
    code: { fontFamily: "Courier", fontSize: 10 },
    link: { color: t.primary, textDecoration: "underline" },
  });
}

type S = ReturnType<typeof styles>;

function Runs({ runs, s }: { runs: Run[]; s: S }) {
  return (
    <>
      {runs.map((r, i) => {
        const st = { ...(r.bold ? { fontWeight: 700 as const } : {}), ...(r.italic ? { fontStyle: "italic" as const } : {}), ...(r.code ? s.code : {}) };
        return r.href ? (
          <Link key={i} src={r.href} style={{ ...st, ...s.link }}>
            {r.text}
          </Link>
        ) : (
          <Text key={i} style={st}>
            {r.text}
          </Text>
        );
      })}
    </>
  );
}

function BlockView({ b, s }: { b: Block; s: S }) {
  switch (b.type) {
    case "heading":
      return (
        <Text style={b.level === 2 ? s.h2 : b.level === 3 ? s.h3 : s.h4} minPresenceAhead={40}>
          <Runs runs={b.runs} s={s} />
        </Text>
      );
    case "paragraph":
      return (
        <Text style={s.p}>
          <Runs runs={b.runs} s={s} />
        </Text>
      );
    case "list":
      return (
        <View style={{ marginBottom: 6 }}>
          {b.items.map((it, i) => (
            <View key={i} style={s.listRow} wrap={false}>
              <Text style={s.bullet}>{b.ordered ? `${i + 1}.` : "•"}</Text>
              <Text style={s.listText}>
                <Runs runs={it} s={s} />
              </Text>
            </View>
          ))}
        </View>
      );
    case "checklist":
      return (
        <View style={{ marginBottom: 6 }}>
          {b.items.map((it, i) => (
            <View key={i} style={s.listRow} wrap={false}>
              <View style={[s.box, it.checked ? { backgroundColor: "#6b7280" } : {}]} />
              <Text style={s.listText}>
                <Runs runs={it.runs} s={s} />
              </Text>
            </View>
          ))}
        </View>
      );
    case "table":
      return (
        <View style={s.table}>
          <View style={s.tr} wrap={false}>
            {b.header.map((c, i) => (
              <Text key={i} style={s.th}>
                <Runs runs={c} s={s} />
              </Text>
            ))}
          </View>
          {b.rows.map((r, ri) => (
            <View key={ri} style={s.tr} wrap={false}>
              {b.header.map((_, ci) => (
                <Text key={ci} style={s.td}>
                  <Runs runs={r[ci] ?? []} s={s} />
                </Text>
              ))}
            </View>
          ))}
        </View>
      );
    case "callout":
      return (
        <View style={s.callout} wrap={false}>
          {b.label ? <Text style={s.calloutLabel}>{b.label}</Text> : null}
          <Text>
            <Runs runs={b.runs} s={s} />
          </Text>
        </View>
      );
    case "quote":
      return (
        <Text style={s.quote}>
          <Runs runs={b.runs} s={s} />
        </Text>
      );
    case "image":
      return (
        <View wrap={false}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={b.src} style={s.image} />
          {b.alt ? <Text style={s.caption}>{b.alt}</Text> : null}
        </View>
      );
    case "pagebreak":
      return <View break />;
  }
}

function PdfDoc({ project, content }: { project: PdfProject; content: PdfContent }) {
  const s = styles(project);
  const t = project.theme;
  const chapters = content.chapters;
  const chrome = (
    <>
      {t.header ? (
        <Text style={s.header} fixed>
          {t.header}
        </Text>
      ) : null}
      <View style={s.footer} fixed>
        <Text>{t.footer || project.title}</Text>
        {t.pageNumbers ? <Text render={({ pageNumber }) => `${pageNumber}`} /> : <Text> </Text>}
      </View>
    </>
  );
  return (
    <Document title={project.title} author={t.author || undefined} language="pt-BR" creator="Central de Comando" producer="Central de Comando">
      <Page size={t.pageSize} style={s.cover}>
        <View style={s.coverBand}>
          <Text style={s.coverTitle}>{project.title}</Text>
          {t.coverSubtitle ? <Text style={s.coverSubtitle}>{t.coverSubtitle}</Text> : null}
        </View>
        <View style={s.coverAccent} />
        {t.author ? <Text style={s.coverAuthor}>{t.author}</Text> : null}
      </Page>
      {t.showToc && chapters.length > 1 ? (
        <Page size={t.pageSize} style={s.page}>
          {chrome}
          <Text style={s.tocTitle}>Sumário</Text>
          {chapters.map((c, i) => (
            <Link key={c.id} src={`#${c.id}`} style={s.tocItem}>
              {`${i + 1}. ${c.title}`}
            </Link>
          ))}
        </Page>
      ) : null}
      {chapters.map((c, i) => (
        <Page key={c.id} size={t.pageSize} style={s.page}>
          {chrome}
          <View id={c.id}>
            <Text style={s.chapterKicker}>{`CAPÍTULO ${i + 1}`}</Text>
            <Text style={s.chapterTitle}>{c.title}</Text>
          </View>
          {parseBlocks(c.markdown).map((b, bi) => (
            <BlockView key={bi} b={b} s={s} />
          ))}
        </Page>
      ))}
    </Document>
  );
}

export async function renderPdf(project: PdfProject, content: PdfContent): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<PdfDoc project={project} content={content} />);
}
