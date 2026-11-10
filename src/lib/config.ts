import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Arquivo de resultados. Use RESULTADOS para separar rodadas (ex.: comparar modelos). */
export function caminhoResultados(): string {
  const caminho = process.env["RESULTADOS"];
  return caminho ? resolve(caminho) : join(ROOT, "resultados", "resultados.jsonl");
}

/** Lê um inteiro >= 0 do ambiente. */
export function inteiroEnv(nome: string, padrao: number): number {
  const bruto = process.env[nome];
  if (bruto === undefined || bruto === "") return padrao;
  const valor = Number(bruto);
  if (!Number.isInteger(valor) || valor < 0) {
    throw new Error(`${nome} deve ser um inteiro >= 0 (recebido: "${bruto}").`);
  }
  return valor;
}

export function numeroEnv(nome: string, padrao: number): number {
  const bruto = process.env[nome];
  if (bruto === undefined || bruto === "") return padrao;
  const valor = Number(bruto);
  if (!Number.isFinite(valor)) throw new Error(`${nome} deve ser um número (recebido: "${bruto}").`);
  return valor;
}
