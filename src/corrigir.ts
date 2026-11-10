import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { chat } from "./lib/ollama.ts";
import { carregarAtividades } from "./lib/fonte.ts";
import { mensagemDeErro } from "./lib/erros.ts";
import { obterCriterios } from "./lib/criterios.ts";
import {
  interpretarResposta,
  montarConteudo,
  montarSchema,
  selecionarExemplos,
} from "./lib/correcao.ts";
import { arredondar, mediana } from "./lib/estatistica.ts";
import { ROOT, caminhoResultados, inteiroEnv, numeroEnv } from "./lib/config.ts";
import type { Correcao, Exemplo, ItemAvaliacao, RegistroResultado } from "./types.ts";

interface Config {
  model: string;
  /** Rodadas por atividade; a nota final é a mediana. */
  repeticoes: number;
  /** 0 trava a resposta; com várias rodadas é preciso > 0 para que elas variem. */
  temperatura: number;
  /** Máximo de exemplos do professor no prompt (0 desativa). */
  fewShot: number;
  seed: number;
}

function lerConfig(): Config {
  const repeticoes = Math.max(1, inteiroEnv("REPETICOES", 3));
  return {
    model: process.env["MODEL"] ?? "gemma4:e4b",
    repeticoes,
    temperatura: numeroEnv("TEMPERATURA", repeticoes > 1 ? 0.4 : 0),
    fewShot: inteiroEnv("FEW_SHOT", 3),
    seed: inteiroEnv("SEED", 42),
  };
}

function segundosDesde(inicio: number): number {
  return Number(((performance.now() - inicio) / 1000).toFixed(1));
}

async function corrigirItem(
  config: Config,
  prompt: string,
  item: ItemAvaliacao,
  todosExemplos: readonly Exemplo[],
): Promise<RegistroResultado> {
  const inicio = performance.now();
  // Daqui em diante só `atividade` é usada no prompt; a nota do professor vai apenas para o registro.
  const { atividade } = item;
  const criterios = obterCriterios(atividade);
  const exemplos = selecionarExemplos(atividade, todosExemplos, config.fewShot);
  const conteudo = montarConteudo(atividade, exemplos, criterios);
  const schema = montarSchema(criterios);

  const correcoes: Correcao[] = [];
  let ultimoErro = "";

  for (let rodada = 0; rodada < config.repeticoes; rodada++) {
    try {
      const resposta = await chat({
        model: config.model,
        format: schema,
        temperature: config.temperatura,
        seed: config.seed + rodada,
        think: false,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: conteudo },
        ],
      });
      correcoes.push(interpretarResposta(resposta, criterios, atividade.nota_maxima));
    } catch (err) {
      ultimoErro = mensagemDeErro(err);
    }
  }

  const falhas = config.repeticoes - correcoes.length;
  if (correcoes.length === 0) {
    return {
      id: atividade.id,
      nota_professor: item.nota_professor,
      nota_maxima: atividade.nota_maxima,
      nota_modelo: null,
      justificativa: null,
      erro: `${falhas}/${config.repeticoes} rodadas falharam. Último erro: ${ultimoErro}`,
      tempo_s: segundosDesde(inicio),
    };
  }

  const notas = correcoes.map((c) => c.nota);
  const notaFinal = mediana(notas);
  // A justificativa exibida é a da rodada mais próxima da mediana.
  const representativa = correcoes.reduce((melhor, c) =>
    Math.abs(c.nota - notaFinal) < Math.abs(melhor.nota - notaFinal) ? c : melhor,
  );

  return {
    id: atividade.id,
    nota_professor: item.nota_professor,
    nota_maxima: atividade.nota_maxima,
    nota_modelo: arredondar(notaFinal),
    justificativa: representativa.justificativa,
    erro: null,
    notas_rodadas: notas,
    dispersao: arredondar(Math.max(...notas) - Math.min(...notas)),
    falhas_rodadas: falhas,
    exemplos_usados: exemplos.length,
    ...(representativa.criterios ? { criterios: representativa.criterios } : {}),
    tempo_s: segundosDesde(inicio),
  };
}

function formatarLinha(r: RegistroResultado): string {
  if (r.erro !== null) {
    return `${r.id} | prof=${r.nota_professor}/${r.nota_maxima} | ERRO: ${r.erro} | ${r.tempo_s}s`;
  }
  const rodadas = r.notas_rodadas.length > 1 ? ` [${r.notas_rodadas.join(", ")}]` : "";
  const avisos = [
    r.criterios ? `${r.criterios.length} critérios` : "nota única",
    `${r.exemplos_usados} ex.`,
    ...(r.falhas_rodadas > 0 ? [`${r.falhas_rodadas} falha(s)`] : []),
  ].join(", ");
  return `${r.id} | prof=${r.nota_professor}/${r.nota_maxima} | modelo=${r.nota_modelo}${rodadas} | ${avisos} | ${r.tempo_s}s`;
}

async function main(): Promise<void> {
  const config = lerConfig();
  const prompt = await readFile(join(ROOT, "prompts", "correcao.txt"), "utf-8");
  const { itens, exemplos } = await carregarAtividades(ROOT);

  const saida = caminhoResultados();
  await mkdir(dirname(saida), { recursive: true });

  console.log(`Modelo: ${config.model}`);
  console.log(
    `Rodadas: ${config.repeticoes} | Temperatura: ${config.temperatura} | Few-shot: até ${config.fewShot} (${exemplos.length} exemplos disponíveis)`,
  );
  console.log(`Atividades: ${itens.length}\n`);

  const registros: RegistroResultado[] = [];
  for (const item of itens) {
    const registro = await corrigirItem(config, prompt, item, exemplos);
    registros.push(registro);
    console.log(formatarLinha(registro));
  }

  const conteudo = registros.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await writeFile(saida, conteudo, "utf-8");
  console.log(`\nResultados salvos em: ${saida}`);
}

main().catch((err: unknown) => {
  console.error("Falha na execução:", mensagemDeErro(err));
  process.exit(1);
});
