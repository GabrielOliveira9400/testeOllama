/** Critério da rubrica com pontuação máxima. */
export interface Criterio {
  nome: string;
  pontos: number;
}

/**
 * Tudo o que o modelo pode ver. Não tem nota do professor de propósito:
 * só este objeto é usado para montar o prompt.
 */
export interface AtividadeParaCorrecao {
  id: string;
  enunciado: string;
  rubrica: string;
  resposta: string;
  /** Escala da nota (ex.: 5 no fórum, 10 no dataset de exemplo). */
  nota_maxima: number;
  /** Critérios explícitos. Se ausentes, são extraídos da rubrica no formato "Nome (N pontos)". */
  criterios?: Criterio[];
}

/** Atividade a corrigir e a nota do professor, mantidas em campos separados. */
export interface ItemAvaliacao {
  atividade: AtividadeParaCorrecao;
  /** Só para comparação. Nunca é passada para o prompt. */
  nota_professor: number;
}

/** Atividade já corrigida, mostrada ao modelo como exemplo (few-shot). Só na fonte arquivo. */
export interface Exemplo {
  atividade: AtividadeParaCorrecao;
  nota_professor: number;
  justificativa_professor?: string;
}

/** Uma linha de data/dataset.jsonl. */
export interface ItemDataset {
  id: string;
  enunciado: string;
  rubrica: string;
  resposta: string;
  nota_professor: number;
  /** Padrão: 10. */
  nota_maxima?: number;
  criterios?: Criterio[];
  /** Atividade usada só como exemplo no prompt (few-shot). Não é corrigida nem avaliada. */
  exemplo?: boolean;
  justificativa_professor?: string;
}

export interface CriterioAvaliado {
  nome: string;
  pontos: number;
  maximo: number;
  justificativa: string;
}

/** Correção de uma rodada, já validada. */
export interface Correcao {
  nota: number;
  justificativa: string;
  /** Presente quando a correção foi feita por critério. */
  criterios?: CriterioAvaliado[];
}

interface RegistroBase {
  id: string;
  nota_professor: number;
  nota_maxima: number;
  tempo_s: number;
}

export interface RegistroSucesso extends RegistroBase {
  /** Mediana das rodadas válidas. */
  nota_modelo: number;
  justificativa: string;
  erro: null;
  notas_rodadas: number[];
  /** Maior nota menos a menor nota entre as rodadas. Alta = modelo inseguro. */
  dispersao: number;
  falhas_rodadas: number;
  exemplos_usados: number;
  criterios?: CriterioAvaliado[];
}

export interface RegistroFalha extends RegistroBase {
  nota_modelo: null;
  justificativa: null;
  erro: string;
}

/** Uma linha de resultados/resultados.jsonl. */
export type RegistroResultado = RegistroSucesso | RegistroFalha;

export type Validador<T> = (valor: unknown, linha: number) => T;

// ---------- Validadores (dados externos chegam como `unknown`) ----------

export function isObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function exigirString(obj: Record<string, unknown>, campo: string, linha: number): string {
  const v = obj[campo];
  if (typeof v !== "string") {
    throw new Error(`Linha ${linha}: campo "${campo}" deve ser texto.`);
  }
  return v;
}

function exigirNumero(obj: Record<string, unknown>, campo: string, linha: number): number {
  const v = obj[campo];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`Linha ${linha}: campo "${campo}" deve ser número.`);
  }
  return v;
}

function numeroOu(valor: unknown, padrao: number): number {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : padrao;
}

function lerCriterios(valor: unknown, linha: number): Criterio[] {
  if (!Array.isArray(valor)) {
    throw new Error(`Linha ${linha}: campo "criterios" deve ser uma lista.`);
  }
  return valor.map((c: unknown, i) => {
    if (!isObjeto(c)) throw new Error(`Linha ${linha}: criterios[${i}] deve ser um objeto.`);
    const nome = exigirString(c, "nome", linha);
    const pontos = exigirNumero(c, "pontos", linha);
    if (pontos <= 0) throw new Error(`Linha ${linha}: criterios[${i}].pontos deve ser maior que 0.`);
    return { nome, pontos };
  });
}

export const validarItemDataset: Validador<ItemDataset> = (valor, linha) => {
  if (!isObjeto(valor)) throw new Error(`Linha ${linha}: esperado um objeto JSON.`);
  const item: ItemDataset = {
    id: exigirString(valor, "id", linha),
    enunciado: exigirString(valor, "enunciado", linha),
    rubrica: exigirString(valor, "rubrica", linha),
    resposta: exigirString(valor, "resposta", linha),
    nota_professor: exigirNumero(valor, "nota_professor", linha),
  };

  if (valor["nota_maxima"] !== undefined) {
    const max = exigirNumero(valor, "nota_maxima", linha);
    if (max <= 0) throw new Error(`Linha ${linha}: "nota_maxima" deve ser maior que 0.`);
    item.nota_maxima = max;
  }
  if (valor["criterios"] !== undefined) {
    item.criterios = lerCriterios(valor["criterios"], linha);
  }
  if (valor["exemplo"] !== undefined) {
    if (typeof valor["exemplo"] !== "boolean") {
      throw new Error(`Linha ${linha}: campo "exemplo" deve ser true ou false.`);
    }
    item.exemplo = valor["exemplo"];
  }
  if (valor["justificativa_professor"] !== undefined) {
    item.justificativa_professor = exigirString(valor, "justificativa_professor", linha);
  }
  return item;
};

/** Aceita também resultados gerados por versões anteriores (campos novos recebem padrão). */
export const validarRegistro: Validador<RegistroResultado> = (valor, linha) => {
  if (!isObjeto(valor)) throw new Error(`Linha ${linha}: esperado um objeto JSON.`);
  const base: RegistroBase = {
    id: exigirString(valor, "id", linha),
    nota_professor: exigirNumero(valor, "nota_professor", linha),
    nota_maxima: numeroOu(valor["nota_maxima"], 10),
    tempo_s: exigirNumero(valor, "tempo_s", linha),
  };

  if (valor["erro"] === null) {
    const nota_modelo = exigirNumero(valor, "nota_modelo", linha);
    const rodadas = valor["notas_rodadas"];
    return {
      ...base,
      nota_modelo,
      justificativa: exigirString(valor, "justificativa", linha),
      erro: null,
      notas_rodadas:
        Array.isArray(rodadas) && rodadas.every((n): n is number => typeof n === "number")
          ? rodadas
          : [nota_modelo],
      dispersao: numeroOu(valor["dispersao"], 0),
      falhas_rodadas: numeroOu(valor["falhas_rodadas"], 0),
      exemplos_usados: numeroOu(valor["exemplos_usados"], 0),
    };
  }
  return {
    ...base,
    nota_modelo: null,
    justificativa: null,
    erro: exigirString(valor, "erro", linha),
  };
};
