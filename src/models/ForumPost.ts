import { Schema, model, type Model, type Types } from "mongoose";

/**
 * Coleção `ForumsPosts` do sistema da escola. SOMENTE LEITURA.
 *
 * Dados pessoais (cpf, _enrolmentId, post.user, post.ipSending) não são mapeados
 * de propósito: não são necessários para a correção e não devem ser carregados.
 */
export interface IForumPost {
  _id: Types.ObjectId;
  forum: {
    _id: Types.ObjectId;
    title?: string;
  };
  post: {
    /** Texto do aluno (pode conter HTML). */
    message: string;
    launchedAt?: Date;
  };
  /**
   * Nota dada pelo professor. Usada só na comparação (avaliar);
   * nunca entra no objeto enviado ao modelo.
   */
  grade?: number | null;
}

export type ForumPostModel = Model<IForumPost>;

const forumPostSchema = new Schema<IForumPost, ForumPostModel>(
  {
    forum: {
      _id: { type: Schema.Types.ObjectId, required: true },
      title: { type: String },
    },
    post: {
      message: { type: String, required: true },
      launchedAt: { type: Date },
    },
    grade: { type: Number },
  },
  {
    collection: "ForumsPosts",
    autoCreate: false,
    autoIndex: false,
  },
);

export const ForumPost = model<IForumPost, ForumPostModel>("ForumPost", forumPostSchema);
