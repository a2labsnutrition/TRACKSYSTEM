/**
 * Verificador de políticas (determinístico, pt-BR). Aponta trechos ARRISCADOS
 * para as políticas de anúncios do Meta e, em saúde, CONAR/ANVISA. Não substitui
 * a revisão humana: ele sinaliza; a IA sugere a reescrita; você decide.
 */

export type ComplianceSeverity = "alto" | "medio";

export interface ComplianceRule {
  id: string;
  label: string;
  severity: ComplianceSeverity;
  reason: string;
  re: RegExp;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Os padrões rodam sobre o texto sem acentos e em minúsculas.
export const RULES: ComplianceRule[] = [
  { id: "renda_valor", label: "Promessa de ganho em dinheiro", severity: "alto", reason: "O Meta restringe promessas de renda/ganhos específicos ou irreais.", re: /(ganh(e|ar|ou|ando)|fatur(e|ar|ou|ando)|lucr(e|ar|ou)|tire|tirar)\s+(ate\s+|mais de\s+)?r\$\s?\d/ },
  { id: "renda_garantida", label: "Renda garantida / enriquecimento rápido", severity: "alto", reason: "Promessas de renda garantida e enriquecimento rápido são proibidas.", re: /(renda|dinheiro|lucro)\s+(extra\s+)?garantid|(fique|ficar|ficou)\s+rico|dinheiro\s+facil|enriquec\w*\s+rapid|sem\s+(esforco|precisar trabalhar)|independencia financeira em \d+/ },
  { id: "resultado_garantido", label: "Resultado garantido", severity: "alto", reason: "Garantir resultado (vendas, cura, perda de peso) é enganoso; garanta só o reembolso.", re: /resultados?\s+garantid|100%\s+garantid|garantimos\s+(que|o resultado|resultado)|funciona\s+para\s+(todos|qualquer pessoa)|sucesso\s+garantid/ },
  { id: "saude_peso", label: "Perda de peso com número ou prazo", severity: "alto", reason: "O Meta proíbe promessas de perda de peso em prazo/quantidade e imagens de antes/depois.", re: /(perca|perder|perdi|eliminar?|emagre(ca|cer|ci))\s+(ate\s+)?\d+\s?(kg|quilos)|\d+\s?(kg|quilos)\s+em\s+\d+\s+dias/ },
  { id: "saude_cura", label: "Alegação de cura ou tratamento", severity: "alto", reason: "Alegações terapêuticas exigem comprovação (ANVISA/CONAR) e são restritas no Meta.", re: /\b(cura|curar|curou|tratamento definitivo|milagr\w*|remedio natural|acabe com a? ?(ansiedade|depressao|diabetes|dor))/ },
  { id: "antes_depois", label: "Antes e depois", severity: "alto", reason: "Imagens/descrições de antes e depois são proibidas em saúde, estética e emagrecimento.", re: /antes\s*(e|\/)\s*depois/ },
  { id: "atributo_pessoal", label: "Atributo pessoal de quem vê", severity: "alto", reason: "Não pode afirmar ou insinuar condição pessoal (saúde, finanças, religião, relacionamento) de quem vê o anúncio.", re: /\bvoce\s+(esta|e|anda|tem|sofre de|vive)\s+.{0,25}(endividad|gord|obes|ansios|deprimid|divorciad|solteir|doente|diabetic|careca|calvo|acima do peso|sem dinheiro|falid|quebrad)/ },
  { id: "urgencia", label: "Urgência ou escassez", severity: "medio", reason: "Escassez só se for verdadeira; urgência falsa é prática enganosa.", re: /\b(so hoje|somente hoje|ultimas?\s+\d+\s+vagas|acaba\s+(hoje|em\s+\d+\s+(minutos|horas))|nunca mais|preco sobe amanha)/ },
  { id: "prova_numerica", label: "Número de alunos/clientes", severity: "medio", reason: "Use números de alunos, clientes ou faturamento só se forem reais e comprováveis.", re: /\+?\s?\d{1,3}(\.\d{3})+\s+(alunos|alunas|clientes|pessoas|vendas)|\+\s?\d+\s?mil\s+(alunos|clientes|pessoas)/ },
  { id: "sem_esforco", label: "Sem esforço / fácil demais", severity: "medio", reason: "Promessas de resultado sem esforço tendem a ser vistas como enganosas.", re: /(sem\s+dieta|sem\s+academia|sem\s+sair de casa\s+e\s+ganhar|enquanto\s+dorme|no\s+piloto\s+automatico)/ },
];

export interface ComplianceFlag {
  rule: string;
  label: string;
  severity: ComplianceSeverity;
  reason: string;
  section: string;
  excerpt: string;
}

export function scanText(text: string, section: string): ComplianceFlag[] {
  if (!text) return [];
  const n = norm(text);
  const flags: ComplianceFlag[] = [];
  for (const r of RULES) {
    const re = new RegExp(r.re.source, "g");
    let m: RegExpExecArray | null;
    let count = 0;
    while ((m = re.exec(n)) && count < 3) {
      count++;
      // o texto normalizado tem o mesmo tamanho do original para caracteres latinos comuns (remoção só de diacríticos combinantes)
      const start = Math.max(0, m.index - 40);
      const end = Math.min(text.length, m.index + m[0].length + 40);
      const excerpt = `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
      flags.push({ rule: r.id, label: r.label, severity: r.severity, reason: r.reason, section, excerpt });
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return flags;
}

/** Varre todos os textos de um objeto (seção do kit) recursivamente. */
export function scanValue(value: unknown, section: string): ComplianceFlag[] {
  const out: ComplianceFlag[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(...scanText(v, section));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(value);
  // remove duplicados (mesma regra e mesmo trecho)
  const seen = new Set<string>();
  return out.filter((f) => {
    const k = `${f.rule}|${f.excerpt}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
