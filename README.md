# correcao-teste

Teste de correção automática de atividades com um modelo de linguagem local (Ollama), em TypeScript.

O projeto responde a uma pergunta: **o modelo dá notas parecidas com as do professor?**
Ele lê atividades já corrigidas, pede ao modelo uma nota para cada uma, sem mostrar a nota do professor,
e depois compara as duas: erro médio, concordância, viés, estabilidade e calibração.

## Sumário

- [Como rodar](#como-rodar)
- [Arquitetura](#arquitetura)
- [Fluxo da correção](#fluxo-da-correção)
- [Fontes de dados](#fontes-de-dados)
- [Melhorias de correção (sem treinar o modelo)](#melhorias-de-correção-sem-treinar-o-modelo)
- [Métricas da avaliação](#métricas-da-avaliação)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Arquivos do projeto](#arquivos-do-projeto)
- [Privacidade e segurança](#privacidade-e-segurança)

## Como rodar

Requisitos:

- **Node.js 22.18 ou superior.** O Node executa os `.ts` direto (type stripping), então não há build.
  `typescript` e `@types/node` servem só para checar os tipos.
- **[Ollama](https://ollama.com)** rodando localmente, com o modelo baixado.
- **MongoDB**, opcional: só para ler fóruns reais. Sem ele, o projeto usa `data/dataset.jsonl`.

```bash
npm install
ollama pull gemma4:e4b
cp .env.example .env     # ajuste MONGODB_URI, MONGODB_DB e FORUM_ID, ou use FONTE=arquivo
npm run corrigir         # corrige e grava resultados/resultados.jsonl
npm run avaliar          # compara as notas do modelo com as do professor
npm run typecheck        # tsc --noEmit (modo strict)
```

Teste rápido, com uma rodada e 10 atividades:

```bash
REPETICOES=1 LIMITE=10 npm run corrigir
```

## Arquitetura

```
                ┌──────────────────────────┐
                │      Fonte de dados      │
                │  MongoDB (Forums +       │
                │  ForumsPosts) ou         │
                │  data/dataset.jsonl      │
                └────────────┬─────────────┘
                             │ lib/fonte.ts
                             ▼
             ItemAvaliacao { atividade, nota_professor }
                  │                          │
                  │ atividade (sem nota)     │ nota_professor
                  ▼                          │ (guardada à parte)
   ┌─────────────────────────────┐           │
   │ corrigir.ts                 │           │
   │  - critérios (criterios.ts) │           │
   │  - few-shot  (correcao.ts)  │           │
   │  - prompt + schema JSON     │           │
   │  - N rodadas → mediana      │           │
   └──────────────┬──────────────┘           │
                  │ lib/ollama.ts            │
                  ▼                          │
          Ollama /api/chat                   │
          (saída JSON estruturada)           │
                  │                          │
                  ▼                          ▼
        resultados/resultados.jsonl  (nota_modelo + nota_professor)
                             │
                             ▼
              ┌──────────────────────────────┐
              │ avaliar.ts                   │
              │  erro, concordância, viés,   │
              │  estabilidade, calibração,   │
              │  maiores divergências        │
              └──────────────────────────────┘
```

O projeto tem três camadas:

1. **Entrada** (`lib/fonte.ts`, `models/`, `lib/forum.ts`, `lib/html.ts`): carrega as atividades e as normaliza
   para um formato único, separando o que o modelo pode ver (`AtividadeParaCorrecao`) da nota do professor.
2. **Correção** (`corrigir.ts`, `lib/correcao.ts`, `lib/criterios.ts`, `lib/ollama.ts`): monta o prompt, chama o
   modelo, valida a resposta e grava um registro por atividade em JSONL.
3. **Avaliação** (`avaliar.ts`, `lib/estatistica.ts`): lê os resultados e calcula as métricas. Não chama o modelo.

As etapas se comunicam por arquivos JSONL. Assim dá para corrigir uma vez e avaliar quantas vezes quiser,
ou guardar várias configurações em arquivos separados para comparar.

## Fluxo da correção

Para cada atividade, `corrigir.ts` faz o seguinte:

1. **Critérios.** Usa o campo `criterios` da atividade, ou extrai da rubrica os trechos no formato
   `Nome (N pontos)`. Sem critérios, o modelo dá uma nota única.
2. **Exemplos (few-shot).** Escolhe até `FEW_SHOT` atividades corrigidas pelo professor com o mesmo enunciado,
   espalhadas pela faixa de notas. Só existem na fonte arquivo.
3. **Prompt.** Junta o prompt de sistema (`prompts/correcao.txt`), o enunciado, a rubrica, os exemplos, a resposta
   do aluno e as instruções de formato.
4. **Schema.** Envia um JSON Schema no campo `format` do Ollama, que obriga o modelo a responder
   `{ justificativa, nota }` ou um objeto com `{ justificativa, pontos }` por critério.
5. **Rodadas.** Repete a chamada `REPETICOES` vezes, com seeds diferentes. A nota final é a **mediana**, e a
   justificativa vem da rodada mais próxima dela. Também guarda a dispersão entre as rodadas.
6. **Validação.** Confere tipos e faixas. No modo por critério, soma os pontos e normaliza para `0..nota_maxima`.
   Uma rodada que falha é contada em `falhas_rodadas`, e a atividade só falha se todas as rodadas falharem.
7. **Registro.** Grava uma linha em `resultados/resultados.jsonl` com a nota do modelo, a nota do professor,
   o tempo e os detalhes.

## Fontes de dados

### MongoDB: fóruns (`FONTE=mongo`)

O projeto só **lê** das coleções do sistema. Nunca escreve nelas nem cria coleções ou índices.

| Coleção | Campos lidos | Uso |
|---|---|---|
| `Forums` | `title`, `description` (HTML), `grade` | O enunciado, a rubrica e a nota **máxima** (escala) |
| `ForumsPosts` | `forum._id`, `post.message`, `grade` | A resposta do aluno e a nota do professor |

- A descrição HTML é convertida em texto. O que vem antes de "CRITÉRIOS DE AVALIAÇÃO" vira o enunciado, essa
  seção vira a rubrica e "DICAS FINAIS" é descartada.
- Posts sem nota e lançamentos manuais (`** Lancamento manual...`) são ignorados.
- `FORUM_ID` aceita vários IDs separados por vírgula.
- Essa fonte não tem exemplos, então o few-shot fica desativado.

### Arquivo (`FONTE=arquivo`)

Lê `data/dataset.jsonl`. Cada linha tem `id`, `enunciado`, `rubrica`, `resposta` e `nota_professor`, além de
`nota_maxima` (padrão 10) e `criterios`, que são opcionais. As linhas com `"exemplo": true` não são corrigidas:
servem de few-shot, junto com a `justificativa_professor`.

Sem `FONTE` definida, o projeto usa o Mongo se `MONGODB_URI` existir e o arquivo se não existir.

## Melhorias de correção (sem treinar o modelo)

| Recurso | Como funciona | Configuração |
|---|---|---|
| Nota por critério | O modelo pontua cada critério da rubrica e a nota é a soma, normalizada para a escala | automático |
| Exemplos do professor | Atividades corrigidas entram no prompt para calibrar o rigor | `FEW_SHOT` (padrão 3, 0 desativa) |
| Várias rodadas | A nota final é a mediana de N correções, e a dispersão indica baixa confiança | `REPETICOES` (padrão 3), `TEMPERATURA` |
| Calibração | `avaliar` ajusta `nota_professor ≈ a + b × nota_modelo` e mede o ganho com validação cruzada | automático (mínimo 5 atividades) |

Para comparar configurações ou modelos, grave cada rodada em um arquivo:

```bash
REPETICOES=1 FEW_SHOT=0 RESULTADOS=resultados/base.jsonl npm run corrigir
RESULTADOS=resultados/melhorado.jsonl npm run corrigir
RESULTADOS=resultados/base.jsonl npm run avaliar
RESULTADOS=resultados/melhorado.jsonl npm run avaliar
```

## Métricas da avaliação

| Métrica | Significado |
|---|---|
| Erro médio absoluto | A diferença média entre a nota do modelo e a do professor |
| Concordância (±`TOLERANCIA`) | O percentual de notas dentro da tolerância (padrão 0,5) |
| Viés médio | Positivo quando o modelo é mais generoso, negativo quando é mais rigoroso |
| Tempo médio | Os segundos por atividade, somando todas as rodadas |
| Dispersão / baixa confiança | A variação entre rodadas; destaca as atividades acima de `LIMIAR_DISPERSAO` |
| Calibração linear | O erro e a concordância depois de ajustar uma reta, medidos com leave-one-out |
| Maiores divergências | As 5 atividades com a maior diferença, com a justificativa do modelo |

Quando o professor deu a mesma nota a todas as atividades, `avaliar` avisa que as métricas não medem a
qualidade do modelo e pula a calibração. Nesse caso, use fóruns com notas variadas.

## Variáveis de ambiente

Os scripts carregam `.env` automaticamente. Veja `.env.example`.

| Variável | Padrão | Descrição |
|---|---|---|
| `FONTE` | automático | `mongo` ou `arquivo` |
| `MONGODB_URI` / `MONGODB_DB` | — | A conexão com o banco |
| `MONGODB_TIMEOUT_MS` | 5000 | O timeout da conexão |
| `FORUM_ID` | — | Os IDs dos fóruns, separados por vírgula |
| `LIMITE` | 0 (todos) | O máximo de atividades corrigidas |
| `MODEL` | `gemma4:e4b` | O modelo do Ollama |
| `OLLAMA_URL` | `http://localhost:11434` | O endereço do Ollama |
| `OLLAMA_TIMEOUT_MS` | 120000 | O timeout de cada chamada ao modelo |
| `REPETICOES` | 3 | As rodadas por atividade |
| `TEMPERATURA` | 0,4 com rodadas, senão 0 | A temperatura do modelo |
| `SEED` | 42 | A seed base, que varia por rodada |
| `FEW_SHOT` | 3 | O número de exemplos no prompt |
| `RESULTADOS` | `resultados/resultados.jsonl` | O arquivo de saída e de entrada da avaliação |
| `TOLERANCIA` | 0,5 | A tolerância da concordância |
| `LIMIAR_DISPERSAO` | 1,5 | A dispersão que marca baixa confiança |

## Arquivos do projeto

```
testeIA/
├── package.json            scripts (corrigir, avaliar, typecheck) e dependências
├── tsconfig.json           TypeScript strict, sem emissão (só checagem)
├── .env.example            modelo de configuração
├── prompts/
│   └── correcao.txt        prompt de sistema do corretor
├── data/
│   └── dataset.jsonl       atividades de exemplo (fonte arquivo)
├── resultados/             saídas JSONL de cada execução (ignorado no git)
└── src/
    ├── corrigir.ts         script 1: corrige as atividades com o modelo
    ├── avaliar.ts          script 2: compara as notas e imprime as métricas
    ├── types.ts            tipos do domínio e validadores de runtime
    ├── models/
    │   ├── Forum.ts        model Mongoose da coleção Forums (somente leitura)
    │   └── ForumPost.ts    model Mongoose da coleção ForumsPosts (somente leitura)
    └── lib/
        ├── fonte.ts        carrega as atividades do Mongo ou do JSONL e separa a nota do professor
        ├── db.ts           conexão e desconexão do Mongoose (URI mascarada no log)
        ├── forum.ts        separa a descrição do fórum em enunciado e rubrica
        ├── html.ts         converte HTML em texto (remove tags, decodifica entidades)
        ├── correcao.ts     seleção de exemplos, JSON Schema, prompt, validação da resposta
        ├── criterios.ts    critérios explícitos ou extraídos da rubrica ("Nome (N pontos)")
        ├── ollama.ts       cliente tipado do /api/chat do Ollama
        ├── estatistica.ts  média, mediana, limitar, regressão linear
        ├── jsonl.ts        leitura de JSONL com validação e número da linha nos erros
        ├── config.ts       raiz do projeto, caminho dos resultados, leitura de variáveis numéricas
        └── erros.ts        formata mensagens de erro (inclui a causa)
```

### Tipos principais (`src/types.ts`)

| Tipo | Papel |
|---|---|
| `AtividadeParaCorrecao` | O **único** objeto usado para montar o prompt: `id`, `enunciado`, `rubrica`, `resposta`, `nota_maxima`, `criterios?`. Não tem nota. |
| `ItemAvaliacao` | Junta `atividade` e `nota_professor`. A nota fica fora da atividade. |
| `Exemplo` | Uma atividade corrigida usada no few-shot, com a nota e a justificativa do professor. |
| `Correcao` | A resposta validada do modelo: `nota`, `justificativa`, `criterios?`. |
| `RegistroSucesso` / `RegistroFalha` | Uma linha do arquivo de resultados. |

## Privacidade e segurança

- **O modelo não vê a nota do professor.** A nota fica em `ItemAvaliacao.nota_professor` e só é usada pelo `avaliar`.
- **Dados pessoais não são lidos.** As consultas usam uma projeção explícita, e `cpf`, `_enrolmentId`,
  `post.user` e `post.ipSending` não são mapeados nos models.
- **O banco não é alterado.** Os models têm `autoCreate: false` e `autoIndex: false`, e o código só faz `find`.
- **Tudo roda localmente.** O modelo roda no Ollama da própria máquina, e nenhum texto de aluno sai dela.
- O `.env` (com a URI do banco) e a pasta `resultados/` estão no `.gitignore`.
