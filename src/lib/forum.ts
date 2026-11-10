import { htmlParaTexto } from "./html.ts";

export interface EnunciadoForum {
  enunciado: string;
  rubrica: string;
}

const TITULO_CRITERIOS = /CRIT[ÉE]RIOS\s+DE\s+AVALIA[ÇC][ÃA]O/i;
const TITULO_DICAS = /DICAS\s+FINAIS/i;

function posicao(texto: string, padrao: RegExp): number | null {
  const i = texto.search(padrao);
  return i >= 0 ? i : null;
}

/**
 * Divide a descrição do fórum em:
 * - enunciado: tudo antes de "CRITÉRIOS DE AVALIAÇÃO" (contextualização e proposta);
 * - rubrica: a escala da nota e a seção de critérios.
 * A seção "DICAS FINAIS" é descartada (orientações de uso do fórum, não de correção).
 */
export function separarDescricao(descricaoHtml: string, notaMaxima: number): EnunciadoForum {
  const texto = htmlParaTexto(descricaoHtml);
  const iCriterios = posicao(texto, TITULO_CRITERIOS);
  const iDicas = posicao(texto, TITULO_DICAS);

  const fimEnunciado = iCriterios ?? iDicas ?? texto.length;
  const enunciado = texto.slice(0, fimEnunciado).trim();

  let criterios = "";
  if (iCriterios !== null) {
    const fim = iDicas !== null && iDicas > iCriterios ? iDicas : texto.length;
    // Remove a linha do título "CRITÉRIOS DE AVALIAÇÃO".
    criterios = texto.slice(iCriterios, fim).replace(/^[^\n]*\n?/, "").trim();
  }

  const rubrica = [`Nota de 0 a ${notaMaxima}.`, criterios].filter((p) => p !== "").join("\n");
  return { enunciado, rubrica };
}

/** Lançamentos manuais de nota não têm texto do aluno para corrigir. */
export const LANCAMENTO_MANUAL = /^\s*\*\*\s*lan[cç]amento manual/i;
