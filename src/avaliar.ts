import { lerJsonl } from "./lib/jsonl.ts";
import { mensagemDeErro } from "./lib/erros.ts";
import { caminhoResultados, numeroEnv } from "./lib/config.ts";
import { limitar, media, regressaoLinear, type Reta } from "./lib/estatistica.ts";
import { validarRegistro, type RegistroSucesso } from "./types.ts";

const TOLERANCIA = numeroEnv("TOLERANCIA", 0.5);
//Dispersão entre rodadas a partir da qual a correção é marcada como de baixa confiança.
const LIMIAR_DISPERSAO = numeroEnv("LIMIAR_DISPERSAO", 1.5);
//Mínimo de atividades válidas para estimar a calibração.
const MIN_CALIBRACAO = 5;

interface RegistroComDiferenca extends RegistroSucesso {
  diferenca: number;
}

interface Metricas {
  erroMedio: number;
  concordancia: number;
}

function metricas(previstas: readonly number[], reais: readonly number[]): Metricas {
  const difs = previstas.map((p, i) => Math.abs(p - (reais[i] ?? 0)));
  return {
    erroMedio: media(difs),
    concordancia: difs.filter((d) => d <= TOLERANCIA).length / difs.length,
  };
}

function aplicar(reta: Reta, x: number, notaMaxima: number): number {
  return limitar(reta.a + reta.b * x, 0, notaMaxima);
}

interface Calibracao {
  global: Reta;
  //Medido com validação cruzada leave-one-out: cada nota é prevista por uma reta que não a viu. */
  validada: Metricas;
}

function calibrar(validos: readonly RegistroSucesso[]): Calibracao | null {
  const x = validos.map((r) => r.nota_modelo);
  const y = validos.map((r) => r.nota_professor);
  const global = regressaoLinear(x, y);
  if (!global) return null;

  const previstas: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const reta = regressaoLinear(
      x.filter((_, j) => j !== i),
      y.filter((_, j) => j !== i),
    );
    if (!reta) return null;
    previstas.push(aplicar(reta, x[i] ?? 0, validos[i]?.nota_maxima ?? 10));
  }
  return { global, validada: metricas(previstas, y) };
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const registros = await lerJsonl(caminhoResultados(), validarRegistro);
  const validos = registros.filter((r): r is RegistroSucesso => r.erro === null);

  if (validos.length === 0) {
    console.log("Nenhum registro válido para avaliar.");
    return;
  }

  const diferencas: RegistroComDiferenca[] = validos.map((r) => ({
    ...r,
    diferenca: Math.abs(r.nota_modelo - r.nota_professor),
  }));

  const bruto = metricas(
    validos.map((r) => r.nota_modelo),
    validos.map((r) => r.nota_professor),
  );
  const vies = media(validos.map((r) => r.nota_modelo - r.nota_professor));
  const multiplasRodadas = validos.some((r) => r.notas_rodadas.length > 1);

  const escalas = [...new Set(registros.map((r) => r.nota_maxima))];
  console.log("=== Resumo ===");
  console.log(`Escala da nota:       0 a ${escalas.join(" / ")}`);
  console.log(`Atividades:           ${registros.length}`);
  console.log(`Válidas:              ${validos.length}`);
  console.log(`Falhas:               ${registros.length - validos.length}`);
  console.log(`Erro médio absoluto:  ${bruto.erroMedio.toFixed(2)}`);
  console.log(`Concordância (±${TOLERANCIA}): ${pct(bruto.concordancia)}`);
  console.log(
    `Viés médio:           ${vies >= 0 ? "+" : ""}${vies.toFixed(2)} (${vies > 0 ? "modelo mais generoso" : vies < 0 ? "modelo mais rigoroso" : "sem viés"})`,
  );
  console.log(`Tempo médio:          ${media(registros.map((r) => r.tempo_s)).toFixed(1)}s`);

  const notasProfessor = new Set(validos.map((r) => r.nota_professor));
  const semVariacao = notasProfessor.size === 1;
  if (semVariacao) {
    console.log(
      `\n⚠ O professor deu a mesma nota (${[...notasProfessor].join("")}) a todas as atividades.` +
        "\n  Concordância e erro não medem a qualidade do modelo nesse caso: use fóruns com notas variadas.",
    );
  }

  if (multiplasRodadas) {
    const instaveis = validos.filter((r) => r.dispersao >= LIMIAR_DISPERSAO);
    console.log("\n=== Estabilidade entre rodadas ===");
    console.log(`Dispersão média:      ${media(validos.map((r) => r.dispersao)).toFixed(2)}`);
    console.log(
      `Baixa confiança (≥${LIMIAR_DISPERSAO}): ${instaveis.length} de ${validos.length} (${pct(instaveis.length / validos.length)})`,
    );
    for (const r of instaveis.slice(0, 10)) {
      console.log(`  ${r.id} | rodadas=[${r.notas_rodadas.join(", ")}] | prof=${r.nota_professor}`);
    }
  }

  console.log("\n=== Calibração linear ===");
  if (semVariacao) {
    console.log("Não se aplica: as notas do professor não variam.");
  } else if (validos.length < MIN_CALIBRACAO) {
    console.log(`Precisa de pelo menos ${MIN_CALIBRACAO} atividades válidas (há ${validos.length}).`);
  } else {
    const cal = calibrar(validos);
    if (!cal) {
      console.log("Não foi possível calibrar: o modelo deu a mesma nota para todas as atividades.");
    } else {
      const { a, b } = cal.global;
      console.log(`nota_professor ≈ ${a.toFixed(2)} + ${b.toFixed(2)} × nota_modelo`);
      console.log(
        `Erro médio calibrado: ${cal.validada.erroMedio.toFixed(2)} (antes: ${bruto.erroMedio.toFixed(2)})`,
      );
      console.log(
        `Concordância calibr.: ${pct(cal.validada.concordancia)} (antes: ${pct(bruto.concordancia)})`,
      );
      console.log("(medido com validação cruzada leave-one-out)");
    }
  }

  const maioresErros = [...diferencas].sort((a, b) => b.diferenca - a.diferenca).slice(0, 5);

  console.log("\n=== Maiores divergências ===");
  for (const r of maioresErros) {
    const rodadas = r.notas_rodadas.length > 1 ? ` [${r.notas_rodadas.join(", ")}]` : "";
    console.log(
      `${r.id} | prof=${r.nota_professor}/${r.nota_maxima} | modelo=${r.nota_modelo}${rodadas} | dif=${r.diferenca.toFixed(1)}`,
    );
    console.log(`  Justificativa: ${r.justificativa}\n`);
  }
}

main().catch((err: unknown) => {
  console.error("Falha na avaliação:", mensagemDeErro(err));
  process.exit(1);
});
