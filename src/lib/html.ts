import { decode } from "html-entities";

/** Converte o HTML do editor (CKEditor) em texto simples, mantendo parágrafos e listas. */
export function htmlParaTexto(html: string): string {
  const semTags = html
    .replace(/<img[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/(p|div|li|h[1-6]|ul|ol|tr|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  // Decodifica depois de remover as tags, para que "&lt;" vire "<" no texto final.
  return decode(semTags)
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n\n(?=- )/g, "\n") // itens de lista seguidos, sem linha em branco
    .trim();
}
