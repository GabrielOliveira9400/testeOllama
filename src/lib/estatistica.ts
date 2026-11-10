export function arredondar(valor: number, casas = 2): number {
  const fator = 10 ** casas;
  return Math.round(valor * fator) / fator;
}

export function media(valores: readonly number[]): number {
  return valores.length === 0 ? 0 : valores.reduce((s, v) => s + v, 0) / valores.length;
}

export function mediana(valores: readonly number[]): number {
  if (valores.length === 0) throw new Error("Mediana de lista vazia.");
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  const centro = ordenados[meio] ?? 0;
  return ordenados.length % 2 === 1 ? centro : (centro + (ordenados[meio - 1] ?? centro)) / 2;
}

export function limitar(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor));
}

/** y ≈ a + b·x */
export interface Reta {
  a: number;
  b: number;
}

/** Mínimos quadrados. Retorna null se houver menos de 2 pontos ou x não variar. */
export function regressaoLinear(x: readonly number[], y: readonly number[]): Reta | null {
  const n = Math.min(x.length, y.length);
  if (n < 2) return null;
  const mx = media(x.slice(0, n));
  const my = media(y.slice(0, n));
  let cov = 0;
  let varX = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] ?? 0) - mx;
    cov += dx * ((y[i] ?? 0) - my);
    varX += dx * dx;
  }
  if (varX === 0) return null;
  const b = cov / varX;
  return { a: my - b * mx, b };
}
