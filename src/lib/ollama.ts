const OLLAMA_URL = process.env["OLLAMA_URL"] ?? "http://localhost:11434";
const TIMEOUT_MS = Number(process.env["OLLAMA_TIMEOUT_MS"] ?? 120000);

export type Papel = "system" | "user" | "assistant";

export interface Mensagem {
  role: Papel;
  content: string;
}

//Subconjunto de JSON Schema usado para forçar a saída estruturada. */
export interface JsonSchema {
  type: "object" | "string" | "number" | "integer" | "boolean" | "array";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
}

export interface OpcoesChat {
  //Nome do modelo (ex.: "gemma4:e4b"). */
  model: string;
  messages: Mensagem[];

  format?: JsonSchema;
  //Temperatura baixa para notas estáveis. Padrão: 0. */
  temperature?: number;
  //Desativa o modo de raciocínio (mais rápido). Padrão: false. */
  think?: boolean;
  //Semente de amostragem. Mude a cada rodada para obter respostas independentes. */
  seed?: number;
}

interface RespostaChatOllama {
  message: Mensagem;
  done: boolean;
}

function isRespostaChat(valor: unknown): valor is RespostaChatOllama {
  if (typeof valor !== "object" || valor === null) return false;
  const msg = (valor as { message?: unknown }).message;
  return (
    typeof msg === "object" &&
    msg !== null &&
    typeof (msg as { content?: unknown }).content === "string"
  );
}

/** Envia uma conversa ao Ollama e retorna o texto da resposta. */
export async function chat({
  model,
  messages,
  format,
  temperature = 0,
  think = false,
  seed,
}: OpcoesChat): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      format,
      think,
      stream: false,
      options: { temperature, seed },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const corpo = await res.text();
    throw new Error(`Ollama respondeu HTTP ${res.status}: ${corpo}`);
  }

  const data: unknown = await res.json();
  if (!isRespostaChat(data)) {
    throw new Error("Resposta do Ollama em formato inesperado.");
  }
  return data.message.content;
}
