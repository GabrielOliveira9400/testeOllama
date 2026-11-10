import { join } from "node:path";
import { Types } from "mongoose";
import { conectar, desconectar, mongoConfigurado } from "./db.ts";
import { lerJsonl } from "./jsonl.ts";
import { htmlParaTexto } from "./html.ts";
import { LANCAMENTO_MANUAL, separarDescricao, type EnunciadoForum } from "./forum.ts";
import { Forum, type IForum } from "../models/Forum.ts";
import { ForumPost, type IForumPost } from "../models/ForumPost.ts";
import {
  validarItemDataset,
  type AtividadeParaCorrecao,
  type Exemplo,
  type ItemAvaliacao,
  type ItemDataset,
} from "../types.ts";

export type Fonte = "mongo" | "arquivo";

export interface Atividades {
  /** Atividades a corrigir e avaliar. */
  itens: ItemAvaliacao[];
  /** Atividades corrigidas pelo professor usadas como exemplo no prompt. */
  exemplos: Exemplo[];
}

/** FONTE explícita no .env; sem ela, usa o Mongo se MONGODB_URI estiver definida. */
export function fonteSelecionada(): Fonte {
  const fonte = process.env["FONTE"];
  if (fonte === "mongo" || fonte === "arquivo") return fonte;
  if (fonte !== undefined && fonte !== "") {
    throw new Error(`FONTE inválida: "${fonte}". Use "mongo" ou "arquivo".`);
  }
  return mongoConfigurado() ? "mongo" : "arquivo";
}

function limite(): number {
  return Number(process.env["LIMITE"] ?? 0);
}

// ---------- MongoDB (forums + forumsposts, somente leitura) ----------

type ForumLido = Pick<IForum, "_id" | "title" | "description" | "grade">;
type PostLido = Pick<IForumPost, "_id" | "forum" | "post" | "grade">;

function idsDosForuns(): Types.ObjectId[] {
  const bruto = process.env["FORUM_ID"] ?? "";
  const ids = bruto.split(",").map((s) => s.trim()).filter((s) => s !== "");
  if (ids.length === 0) {
    throw new Error("Defina FORUM_ID no .env (um ou mais IDs de fórum separados por vírgula).");
  }
  return ids.map((id) => {
    if (!/^[a-f0-9]{24}$/i.test(id)) throw new Error(`FORUM_ID inválido: "${id}"`);
    return new Types.ObjectId(id);
  });
}

async function carregarDoMongo(): Promise<Atividades> {
  const ids = idsDosForuns();

  await conectar();
  try {
    const foruns = await Forum.find({ _id: { $in: ids } })
      .select("title description grade")
      .lean<ForumLido[]>()
      .exec();

    const encontrados = new Set(foruns.map((f) => f._id.toString()));
    const ausentes = ids.filter((id) => !encontrados.has(id.toString()));
    if (ausentes.length > 0) {
      throw new Error(`Fórum não encontrado: ${ausentes.join(", ")}`);
    }

    const enunciados = new Map<string, EnunciadoForum & { notaMaxima: number }>();
    for (const f of foruns) {
      if (!(f.grade > 0)) throw new Error(`Fórum ${f._id.toString()} sem nota máxima (grade) válida.`);
      enunciados.set(f._id.toString(), { ...separarDescricao(f.description, f.grade), notaMaxima: f.grade });
      console.log(`Fórum: ${f.title.trim()} (${f._id.toString()}) | nota máxima: ${f.grade}`);
    }

    // Projeção explícita: dados pessoais (cpf, aluno, IP) não são lidos do banco.
    const consulta = ForumPost.find({
      "forum._id": { $in: ids },
      grade: { $ne: null }, // exclui posts sem nota (campo ausente ou null)
    })
      .select("forum._id post.message grade")
      .sort({ _id: 1 })
      .lean<PostLido[]>();

    const posts = await consulta.exec();
    const itens: ItemAvaliacao[] = [];
    let manuais = 0;
    let vazios = 0;

    for (const p of posts) {
      if (LANCAMENTO_MANUAL.test(p.post.message)) {
        manuais++;
        continue;
      }
      const resposta = htmlParaTexto(p.post.message);
      const forum = enunciados.get(p.forum._id.toString());
      if (resposta === "" || !forum || typeof p.grade !== "number") {
        vazios++;
        continue;
      }

      const atividade: AtividadeParaCorrecao = {
        id: p._id.toString(),
        enunciado: forum.enunciado,
        rubrica: forum.rubrica,
        resposta,
        nota_maxima: forum.notaMaxima,
      };
      // A nota do professor fica fora de `atividade`, que é o único objeto usado no prompt.
      itens.push({ atividade, nota_professor: p.grade });
    }

    console.log(
      `Posts com nota: ${posts.length} | ignorados: ${manuais} lançamento(s) manual(is), ${vazios} sem texto`,
    );
    const max = limite();
    return { itens: max > 0 ? itens.slice(0, max) : itens, exemplos: [] };
  } finally {
    await desconectar();
  }
}

// ---------- Arquivo (data/dataset.jsonl) ----------

function paraAtividade(item: ItemDataset): AtividadeParaCorrecao {
  const atividade: AtividadeParaCorrecao = {
    id: item.id,
    enunciado: item.enunciado,
    rubrica: item.rubrica,
    resposta: item.resposta,
    nota_maxima: item.nota_maxima ?? 10,
  };
  if (item.criterios) atividade.criterios = item.criterios;
  return atividade;
}

async function carregarDoArquivo(root: string): Promise<Atividades> {
  const todos = await lerJsonl(join(root, "data", "dataset.jsonl"), validarItemDataset);
  const itens: ItemAvaliacao[] = todos
    .filter((i) => i.exemplo !== true)
    .map((i) => ({ atividade: paraAtividade(i), nota_professor: i.nota_professor }));

  const exemplos: Exemplo[] = todos
    .filter((i) => i.exemplo === true)
    .map((i) => ({
      atividade: paraAtividade(i),
      nota_professor: i.nota_professor,
      ...(i.justificativa_professor ? { justificativa_professor: i.justificativa_professor } : {}),
    }));

  const max = limite();
  return { itens: max > 0 ? itens.slice(0, max) : itens, exemplos };
}

/** Carrega as atividades da fonte configurada, já no formato usado pela correção. */
export async function carregarAtividades(root: string): Promise<Atividades> {
  const fonte = fonteSelecionada();
  console.log(`Fonte: ${fonte}`);
  return fonte === "mongo" ? carregarDoMongo() : carregarDoArquivo(root);
}
