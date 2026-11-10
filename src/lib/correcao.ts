import type { JsonSchema } from "./ollama.ts";
import { arredondar } from "./estatistica.ts";
import {
  isObjeto,
  type AtividadeParaCorrecao,
  type Correcao,
  type Criterio,
  type CriterioAvaliado,
  type Exemplo,
} from "../types.ts";

// ---------- Few-shot ----------

function normalizar(texto: string): string {
  return texto.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Escolhe até `n` exemplos do mesmo enunciado, espalhados pela faixa de notas
 * (da mais baixa à mais alta) para mostrar ao modelo o rigor do professor.
 */
export function selecionarExemplos(
  atividade: AtividadeParaCorrecao,
  exemplos: readonly Exemplo[],
  n: number,
): Exemplo[] {
  if (n <= 0) return [];
  const alvo = normalizar(atividade.enunciado);
  const candidatos = exemplos
    .filter((e) => e.atividade.id !== atividade.id && normalizar(e.atividade.enunciado) === alvo)
    .sort((a, b) => a.nota_professor - b.nota_professor);

  if (candidatos.length <= n) return candidatos;
  if (n === 1) return candidatos.slice(Math.floor(candidatos.length / 2)).slice(0, 1);

  const ultimo = candidatos.length - 1;
  return Array.from({ length: n }, (_, i) => candidatos[Math.round((i * ultimo) / (n - 1))])
    .filter((e): e is Exemplo => e !== undefined);
}

// ---------- Schema e prompt ----------

const SCHEMA_NOTA_UNICA: JsonSchema = {
  type: "object",
  properties: {
    justificativa: { type: "string" },
    nota: { type: "number" },
  },
  required: ["justificativa", "nota"],
};

/** Schema da resposta. Com critérios, cada um vira uma chave obrigatória. */
export function montarSchema(criterios: readonly Criterio[]): JsonSchema {
  if (criterios.length === 0) return SCHEMA_NOTA_UNICA;

  const propriedades: Record<string, JsonSchema> = {};
  for (const c of criterios) {
    propriedades[c.nome] = {
      type: "object",
      properties: {
        justificativa: { type: "string" },
        pontos: { type: "number" },
      },
      required: ["justificativa", "pontos"],
    };
  }

  // `criterios` vem antes de `justificativa` para o modelo avaliar parte por parte primeiro.
  return {
    type: "object",
    properties: {
      criterios: {
        type: "object",
        properties: propriedades,
        required: criterios.map((c) => c.nome),
      },
      justificativa: { type: "string" },
    },
    required: ["criterios", "justificativa"],
  };
}

function instrucoesDeFormato(criterios: readonly Criterio[], notaMaxima: number): string {
  if (criterios.length === 0) {
    return [
      'Escreva primeiro a "justificativa" (texto curto citando os critérios de avaliação)',
      `e depois a "nota" (número de 0 a ${notaMaxima}, pode ter decimais).`,
    ].join(" ");
  }
  const lista = criterios.map((c) => `- ${c.nome}: de 0 a ${c.pontos} pontos`).join("\n");
  return [
    "Avalie cada critério separadamente, na ordem abaixo. Para cada um, escreva",
    'primeiro a "justificativa" (curta, baseada na resposta) e depois os "pontos"',
    "(de 0 até o máximo do critério, pode ter decimais):",
    lista,
    "",
    'Em seguida, escreva em "justificativa" um resumo geral. Não calcule a nota',
    "final: ela será a soma dos pontos.",
  ].join("\n");
}

function blocoExemplos(exemplos: readonly Exemplo[]): string | null {
  if (exemplos.length === 0) return null;
  const blocos = exemplos.map((e, i) =>
    [
      `Exemplo ${i + 1}`,
      `Resposta: ${e.atividade.resposta}`,
      `Nota do professor: ${e.nota_professor} de ${e.atividade.nota_maxima}`,
      ...(e.justificativa_professor ? [`Justificativa do professor: ${e.justificativa_professor}`] : []),
    ].join("\n"),
  );
  return [
    "Exemplos corrigidos pelo professor para este mesmo enunciado.",
    "Use-os apenas para entender o rigor do professor ao aplicar a rubrica.",
    "Não compare a resposta do aluno com os exemplos: uma resposta mais simples",
    "ou mais curta pode receber a pontuação máxima se cumprir o critério.",
    "Não copie as justificativas.",
    "",
    blocos.join("\n\n"),
  ].join("\n");
}

/** Monta a mensagem do usuário. Recebe só `AtividadeParaCorrecao`, que não tem a nota do professor. */
export function montarConteudo(
  atividade: AtividadeParaCorrecao,
  exemplos: readonly Exemplo[],
  criterios: readonly Criterio[],
): string {
  return [
    `Enunciado:\n${atividade.enunciado}`,
    `Critérios de avaliação:\n${atividade.rubrica}`,
    blocoExemplos(exemplos),
    `Resposta do aluno a corrigir:\n${atividade.resposta}`,
    `Formato da resposta:\n${instrucoesDeFormato(criterios, atividade.nota_maxima)}`,
  ]
    .filter((parte): parte is string => parte !== null)
    .join("\n\n");
}

// ---------- Interpretação da resposta ----------

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : String(valor ?? "");
}

/** Valida a resposta do modelo e calcula a nota na escala 0..notaMaxima. */
export function interpretarResposta(
  bruto: string,
  criterios: readonly Criterio[],
  notaMaxima: number,
): Correcao {
  let obj: unknown;
  try {
    obj = JSON.parse(bruto);
  } catch {
    throw new Error(`Modelo não retornou JSON válido: ${bruto.slice(0, 200)}`);
  }
  if (!isObjeto(obj)) throw new Error("Resposta do modelo não é um objeto JSON.");

  const justificativa = texto(obj["justificativa"]);

  if (criterios.length === 0) {
    const nota = Number(obj["nota"]);
    if (!Number.isFinite(nota) || nota < 0 || nota > notaMaxima) {
      throw new Error(`Nota fora do intervalo 0–${notaMaxima}: ${String(obj["nota"])}`);
    }
    return { nota, justificativa };
  }

  const brutos = obj["criterios"];
  if (!isObjeto(brutos)) throw new Error('Resposta sem o objeto "criterios".');

  const avaliados: CriterioAvaliado[] = criterios.map((c) => {
    const r = brutos[c.nome];
    if (!isObjeto(r)) throw new Error(`Critério ausente na resposta: "${c.nome}"`);
    const pontos = Number(r["pontos"]);
    if (!Number.isFinite(pontos) || pontos < 0 || pontos > c.pontos) {
      throw new Error(`Pontos fora do intervalo em "${c.nome}": ${String(r["pontos"])} (máx. ${c.pontos})`);
    }
    return { nome: c.nome, pontos, maximo: c.pontos, justificativa: texto(r["justificativa"]) };
  });

  const obtido = avaliados.reduce((s, c) => s + c.pontos, 0);
  const maximo = avaliados.reduce((s, c) => s + c.maximo, 0);
  // Converte para a escala da atividade mesmo que os critérios não somem a nota máxima.
  return { nota: arredondar((obtido / maximo) * notaMaxima), justificativa, criterios: avaliados };
}
