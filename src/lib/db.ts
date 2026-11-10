import mongoose from "mongoose";

const MONGODB_URI = process.env["MONGODB_URI"];
const MONGODB_DB = process.env["MONGODB_DB"];
const TIMEOUT_MS = Number(process.env["MONGODB_TIMEOUT_MS"] ?? 5000);

/** Esconde usuário e senha da URI antes de exibir no console. */
function mascararUri(uri: string): string {
  return uri.replace(/\/\/[^@/]+@/, "//***:***@");
}

export function mongoConfigurado(): boolean {
  return Boolean(MONGODB_URI);
}

/** Abre a conexão padrão do Mongoose. Lança erro se MONGODB_URI não estiver definida. */
export async function conectar(): Promise<typeof mongoose> {
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI não definida. Configure no arquivo .env.");
  }

  // Falha rápido em vez de enfileirar consultas quando o banco está fora do ar.
  mongoose.set("bufferCommands", false);

  const conexao = await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: TIMEOUT_MS,
    ...(MONGODB_DB ? { dbName: MONGODB_DB } : {}),
  });

  console.log(`MongoDB conectado: ${mascararUri(MONGODB_URI)} (db: ${conexao.connection.name})`);
  return conexao;
}

export async function desconectar(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
