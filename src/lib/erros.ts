/** Extrai uma mensagem legível de qualquer valor lançado (`catch` recebe `unknown`). */
export function mensagemDeErro(err: unknown): string {
  if (err instanceof Error) {
    // fetch encapsula a causa real (ex.: ECONNREFUSED) em `cause`.
    const causa = err.cause instanceof Error ? ` (${err.cause.message})` : "";
    return `${err.message}${causa}`;
  }
  return String(err);
}
