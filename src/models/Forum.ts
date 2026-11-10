import { Schema, model, type Model, type Types } from "mongoose";

/**
 * Coleção `Forums` do sistema da escola. SOMENTE LEITURA.
 * Mapeia apenas os campos usados na correção; o restante do documento é ignorado.
 */
export interface IForum {
  _id: Types.ObjectId;
  title: string;
  /** Enunciado completo em HTML (contextualização, proposta, critérios). */
  description: string;
  type?: string;
  /** Nota MÁXIMA do fórum (escala da correção). Não é nota de aluno. */
  grade: number;
  isActive?: boolean;
}

export type ForumModel = Model<IForum>;

const forumSchema = new Schema<IForum, ForumModel>(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    type: { type: String },
    grade: { type: Number, required: true },
    isActive: { type: Boolean },
  },
  {
    collection: "Forums",
    // Nunca criar coleção nem índices no banco de produção.
    autoCreate: false,
    autoIndex: false,
  },
);

export const Forum = model<IForum, ForumModel>("Forum", forumSchema);
