/**
 * Estatística básica para decisões com poucos dados.
 *
 * Modelo: compras chegam como um processo de Poisson proporcional ao gasto.
 * É a hipótese padrão para contagens raras e permite intervalos EXATOS mesmo
 * com 0, 1 ou 3 compras — sem inventar precisão. Limitações (documentadas na
 * interface): o leilão não é estacionário, há sazonalidade por dia/horário e
 * a atribuição pode estar incompleta.
 */

// ------------------------- funções base -------------------------

/** log Γ(x) (aproximação de Lanczos). */
export function lgamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** P(X ≤ k) para X ~ Poisson(λ). */
export function poissonCdf(k: number, lambda: number): number {
  if (k < 0) return 0;
  if (lambda <= 0) return 1;
  let term = Math.exp(-lambda);
  let sum = term;
  for (let i = 1; i <= k; i++) {
    term *= lambda / i;
    sum += term;
    if (term < 1e-16 * sum && i > lambda) break;
  }
  return Math.min(1, sum);
}

/** Busca binária de λ em [lo, hi] para uma função monótona; `increasing` indica o sentido. */
function solve(f: (x: number) => number, lo: number, hi: number, increasing: boolean): number {
  let a = lo;
  let b = hi;
  for (let i = 0; i < 100; i++) {
    const m = (a + b) / 2;
    const below = increasing ? f(m) < 0 : f(m) > 0;
    if (below) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/** Intervalo exato (Garwood) para a taxa de Poisson com k eventos observados. */
export function poissonInterval(k: number, conf = 0.95): { lower: number; upper: number } {
  const alpha = 1 - conf;
  const hi = k + 20 + 10 * Math.sqrt(k + 1);
  // superior: P(X ≤ k; λ) = α/2 (decresce com λ)
  const upper = solve((l) => poissonCdf(k, l) - alpha / 2, 0, hi, false);
  // inferior: P(X ≥ k; λ) = α/2 (cresce com λ)
  const lower = k === 0 ? 0 : solve((l) => 1 - poissonCdf(k - 1, l) - alpha / 2, 0, hi, true);
  return { lower, upper };
}

/** Intervalo de Wilson para uma proporção (CTR, connect rate, conversão...). */
export function wilson(successes: number, n: number, z = 1.96): { lower: number; upper: number; p: number } | null {
  if (n <= 0) return null;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { lower: Math.max(0, center - half), upper: Math.min(1, center + half), p };
}

function binomPmfLog(k: number, n: number, p: number): number {
  if (p <= 0) return k === 0 ? 0 : -Infinity;
  if (p >= 1) return k === n ? 0 : -Infinity;
  return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1) + k * Math.log(p) + (n - k) * Math.log(1 - p);
}

/** P(X ≤ k) para X ~ Binomial(n, p). */
export function binomialCdf(k: number, n: number, p: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  let total = 0;
  for (let i = 0; i <= k; i++) total += Math.exp(binomPmfLog(i, n, p));
  return Math.min(1, total);
}

/** Teste binomial exato bilateral: P de observar algo tão ou mais extremo que k em n com prob. p. */
export function binomialTwoSided(k: number, n: number, p: number): number {
  if (n === 0) return 1;
  const obs = binomPmfLog(k, n, p);
  let total = 0;
  for (let i = 0; i <= n; i++) {
    const lp = binomPmfLog(i, n, p);
    if (lp <= obs + 1e-9) total += Math.exp(lp);
  }
  return Math.min(1, total);
}

/**
 * Compara as taxas de compra por real gasto de dois grupos (ex.: um criativo
 * x o resto da campanha). Teste condicional exato: dado o total de compras N,
 * sob a hipótese de taxas iguais, as compras do grupo 1 ~ Binomial(N, s1/(s1+s2)).
 */
export function compareRates(k1: number, s1: number, k2: number, s2: number): { pValue: number; ratio: number | null; better: boolean | null } {
  const n = k1 + k2;
  if (n === 0 || s1 <= 0 || s2 <= 0) return { pValue: 1, ratio: null, better: null };
  const p = s1 / (s1 + s2);
  const pValue = binomialTwoSided(k1, n, p);
  const r1 = k1 / s1;
  const r2 = k2 / s2;
  const ratio = r2 > 0 ? r1 / r2 : null;
  return { pValue, ratio, better: r1 === r2 ? null : r1 > r2 };
}

/** Chance de ver ZERO compras com este gasto se o CPA verdadeiro fosse `cpa` (Poisson). */
export function probZeroPurchases(spend: number, cpa: number): number {
  if (cpa <= 0) return 0;
  return Math.exp(-spend / cpa);
}

/** Gasto necessário para que 0 compras seja improvável (< p) se o CPA fosse `cpa`. */
export function spendForZeroProbability(cpa: number, p = 0.05): number {
  return -Math.log(p) * cpa;
}

// ------------------------- CPA -------------------------

export interface CpaInterval {
  point: number | null;
  /** Limites do IC 95% do CPA (lower pode ser > 0 mesmo com 0 compras; upper = null se infinito). */
  lower: number | null;
  upper: number | null;
  purchases: number;
}

export function cpaInterval(spend: number, purchases: number, conf = 0.95): CpaInterval {
  if (spend <= 0) return { point: null, lower: null, upper: null, purchases };
  const { lower, upper } = poissonInterval(purchases, conf);
  return {
    point: purchases > 0 ? spend / purchases : null,
    lower: upper > 0 ? spend / upper : null,
    upper: lower > 0 ? spend / lower : null,
    purchases,
  };
}

/**
 * Quantas compras seriam necessárias, mantendo o CPA atual, para o IC 95%
 * excluir o CPA de equilíbrio (concluir lucro ou prejuízo). null = muito próximo
 * do equilíbrio (inconclusivo mesmo com muitos dados).
 */
export function purchasesToConclude(cpaPoint: number, breakeven: number, max = 3000): number | null {
  if (!(cpaPoint > 0) || !(breakeven > 0)) return null;
  const r = cpaPoint / breakeven;
  if (r > 0.97 && r < 1.03) return null;
  for (let k = 1; k <= max; k = k < 50 ? k + 1 : Math.ceil(k * 1.05)) {
    const { lower, upper } = poissonInterval(k);
    if (r < 1 && lower > 0 && (r * k) / lower < 1) return k;
    if (r > 1 && (r * k) / upper > 1) return k;
  }
  return null;
}

// ------------------------- variação -------------------------

export function coefficientOfVariation(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  if (mean === 0) return null;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1));
  return sd / Math.abs(mean);
}

export function median(values: number[]): number | null {
  const v = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * z-score robusto (mediana e MAD) — resistente a dias atípicos na base.
 * `minScaleFrac` evita escala zero quando a base é quase constante (fração da mediana).
 */
export function robustZ(x: number, baseline: number[], minScaleFrac = 0): number | null {
  const med = median(baseline);
  if (med == null || baseline.length < 4) return null;
  const mad = median(baseline.map((b) => Math.abs(b - med))) ?? 0;
  const scale = Math.max(1.4826 * mad, Math.abs(med) * minScaleFrac);
  if (!scale) return null;
  return (x - med) / scale;
}
