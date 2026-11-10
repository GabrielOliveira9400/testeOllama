import { readFile } from "node:fs/promises";
import type { Validador } from "../types.ts";

/** Lê um arquivo JSONL e valida cada linha, informando o número da linha em caso de erro. */
export async function lerJsonl<T>(caminho: string, validar: Validador<T>): Promise<T[]> {
  const texto = await readFile(caminho, "utf-8");
  const itens: T[] = [];

  texto.split("\n").forEach((linha, indice) => {
    if (linha.trim() === "") return;
    const numero = indice + 1;
    let bruto: unknown;
    try {
      bruto = JSON.parse(linha);
    } catch {
      throw new Error(`Linha ${numero} de ${caminho}: JSON inválido.`);
    }
    itens.push(validar(bruto, numero));
  });

  return itens;
}
