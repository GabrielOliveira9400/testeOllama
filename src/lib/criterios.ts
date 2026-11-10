import type { AtividadeParaCorrecao, Criterio } from "../types.ts";

// Captura trechos como "Conceito correto (4 pontos)" ou "exemplo (2,5 pts)".
const PADRAO = /([^,.;:()\n]+?)\s*\(\s*(\d+(?:[.,]\d+)?)\s*(?:pontos?|pts?)\s*\)/gi;

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Critérios usados na correção por critério.
 * Usa `item.criterios` se existir; senão tenta extrair da rubrica.
 * Lista vazia = correção com nota única.
 */
export function obterCriterios(item: AtividadeParaCorrecao): Criterio[] {
  if (item.criterios && item.criterios.length > 0) return item.criterios;

  const criterios: Criterio[] = [];
  for (const m of item.rubrica.matchAll(PADRAO)) {
    const nome = m[1]?.trim();
    const pontos = Number(m[2]?.replace(",", "."));
    if (nome && Number.isFinite(pontos) && pontos > 0) {
      criterios.push({ nome: capitalizar(nome), pontos });
    }
  }

  // Os nomes viram chaves do JSON de resposta; nomes repetidos inviabilizam o modo por critério.
  const unicos = new Set(criterios.map((c) => c.nome.toLowerCase()));
  return unicos.size === criterios.length ? criterios : [];
}
