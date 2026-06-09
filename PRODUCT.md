# Tormod — Visão & Roadmap

> *Þórmóðr, "a mente de Thor" — o pensamento casado ao martelo.*
> No homelab cujo hub se chama `odin`, o Tormod é a mente que pensa empunhando o martelo que age — sempre com o humano segurando a última palavra.

Este documento é o **norte de longo prazo**: a visão durável e a escada de releases. O **design do MVP atual** (o que está sendo construído agora) vive na spec aprovada em [`docs/superpowers/specs/2026-06-08-tormod-design.md`](docs/superpowers/specs/2026-06-08-tormod-design.md), que é a fonte da verdade da implementação. Onde os dois se cruzarem, a spec manda no "como"; este arquivo manda no "para onde".

---

## 1. Visão

O Tormod é a **superfície única de gestão do homelab**: o lugar de onde se conversa com o cérebro, se opera o fleet, e — no futuro — se documenta, se vê consumo e se gerencia config. Não é um app de ops que incha; é uma **plataforma que cresce por módulos** sobre um chassi extensível.

A divisão de papéis é o invariante que sustenta tudo:

- **O servidor é o produto.** O back (Node/Hono) autentica, gerencia o ciclo de vida das sessões, faz a ponte SSE, persiste audit. Nunca chama LLM, nunca guarda API key.
- **O cérebro é cliente.** Quem pensa e age é o Claude Code, rodando como processo separado, dirigido pelo Claude Agent SDK, atrás da fronteira `BrainAdapter`. Trocável sem reescrever nada acima da fronteira.
- **O front é a interface.** Só renderiza: chat, sessões, cards de aprovação. No futuro, vira o **shell de módulos** que agrega as demais superfícies.

Norte de plataforma: o Tormod é o **hub**; outros serviços do homelab (o Mimir à frente, e o que vier) plugam como **satélites**, expondo capacidades que o front agrega e renderiza como módulos. Acertar esse contrato cedo é o que permite "crescer planejado" em vez de virar god-object.

---

## 2. O chassi (decisão arquitetural mais importante)

O front do MVP não é "uma tela de chat" — é a **semente do chassi**. Dois requisitos de design valem desde já:

1. **Sistema de módulos/navegação extensível** — cada superfície futura (Dashboard, Docs, Config, Usage) pluga numa navegação sem reescrever o shell.
2. **Contrato back↔front estável** — a forma como o front descobre e consome capacidades não muda a cada feature nova.

Isso é o que separa uma plataforma de um app que incha. O módulo **Chat/Ops** (o MVP) é só o primeiro a ocupar o palco.

---

## 3. Escada de releases

Agrupadas por **superfície de produto**, não por feature solta. O MVP é a base; os demais módulos plugam no chassi do front.

```
MVP (em construção) — Chat/Ops
   conversar com o Claude Code · sessões · cards de aprovação · audit
   → é a spec de 2026-06-08; o chassi do front nasce aqui
        │
        ├─ Config-as-tools / Config UI   gerir .claude/ (skills · memórias · agentes)
        │                                editor frontmatter-aware, visão de precedência
        ├─ Dashboard (home)              widgets read-only de saúde/serviços/nodes;
        │                                companheiro ou substituto do Glance atual
        ├─ Document Workspace            editor .md no padrão chat+canvas (ver §4)
        └─ Usage & Observability         consumo por hora/7d · contexto · modelo · custo R$
                                         → primeira fatia do Mimir
        │
   Mimir (microsserviço)  memória · histórico · conhecimento · métricas de tendência
                          longa (30/90d) · tamper-evidence no audit. Acopla ao front
                          do Tormod como módulo, pelo contrato do chassi.
```

Ordem e profundidade de cada módulo são decisões em aberto (ver §6). A única dependência dura: **tudo depende do chassi**, que nasce com o MVP.

---

## 4. Document Workspace (modelo definido)

Quando madurar, o módulo de Docs segue o padrão **chat + canvas**: durante a conversa, o cérebro escreve/edita um `.md` via tool → o Tormod detecta e oferece "abrir no editor?" → ao aceitar, o chat colapsa numa coluna fina à esquerda e o documento abre no centro. É só estado de layout no front; nada novo no back além do que o chassi já dá.

**Sync nível-de-arquivo (não keystroke).** O `.md` no disco é a fonte da verdade, com duas latências assumidas honestamente:

- **Cérebro → você:** ele salva via tool de escrita; o Tormod detecta (hash/mtime) e empurra por SSE; o editor atualiza **em blocos, não caractere a caractere**. Rápido, mas em saltos.
- **Você → cérebro:** ele não acompanha tecla a tecla — lê o arquivo quando vai agir. Você edita → autosave com debounce → Tormod persiste → na próxima leitura, ele vê tua versão.

**Regra de turno** (resolve o conflito): com o editor aberto e em foco, *você* é dono da escrita — edições do cérebro chegam como sugestão/diff, não sobrescrevem. Ao fechar o editor ou pedir explicitamente pro cérebro editar, o turno passa pra ele. Garantia: **mudança do cérebro aparece na hora; teu texto nunca é atropelado.**

**Editor:** MDXEditor ou CodeMirror 6 (decisão na hora de construir). **Sem lib de colaboração** (Yjs/CRDT seria over-engineering pra um humano + um agente em nível de arquivo).

---

## 5. Acoplamento ao fornecedor (e como permanecer trocável)

O cérebro é o Claude Code hoje, mas o projeto é desenhado pra trocá-lo sem dor.

| Ponto de acoplamento | Grau | Mitigação |
|---|---|---|
| Cérebro = Claude Code | trocável | Mora atrás do `BrainAdapter`. Trocar = escrever um novo adapter (Codex, ou LLM local via Goose/Cline → Ollama). Nada acima da fronteira muda. |
| Leitura do formato `~/.claude` (transcripts, usage) | leve | Tratado como adapter opcional, não dependência. O audit é próprio do Tormod. |
| Config-as-tools (gerir `.claude/`) | irredutível, mas modular | É config do próprio cérebro. Trocou de cérebro, troca o módulo. Não é core. |
| UX de aprovação apoiada no `canUseTool` do harness | baixo | O gate real é a Permission Policy do back, agnóstica. Adapter futuro só sobrevive com card granular se o harness expõe gancho de permissão por-tool. |

**Invariantes de design (não-negociáveis):**

- O servidor é o produto; o cérebro é cliente. Nunca embutir "Claude-ismos" fora da fronteira `BrainAdapter`.
- O back **nunca** chama API de LLM nem guarda API key — quem fala com o modelo é o cérebro, em processo separado.
- O back nunca vira o loop que chama o LLM. O modelo mora dentro do adapter/harness.
- Dono dos próprios dados — não depender de formato privado do cliente.

---

## 6. Decisões em aberto

- **Ordem Dashboard × Usage** — o dashboard tem valor de hábito alto (golpe no Glance); ver consumo pode ser dor mais urgente. Inverter é trivial.
- **Dashboard read-only vs. acionável** — no minuto que um widget ganha botão "restart", ele herda todo o modelo de tiers/aprovação. Decidir cedo muda o design.
- **Dashboard vs. Glance** — o dashboard atual **é** o Glance (Prometheus via custom-api + scraper próprio). O módulo de home precisa decidir entre **conviver** (Tormod agrega o Glance) ou **substituir** (e descartar trabalho recente).
- **Profundidade do Usage** — 7 dias agrega on-the-fly (read-only); tendência de 30/90d exige store de rollup — aí já é Mimir de verdade.
- **Refino do mark** — a metáfora está fechada (cérebro + Mjölnir + raio, minimalista, sobre navy); o desenho final é trabalho da fase de UI.

---

## 7. Riscos do projeto

| Risco | Severidade | Mitigação |
|---|---|---|
| **Raio de explosão** — o cérebro alcança o fleet inteiro via SSH; bug na policy, cérebro enganado ou injection → estrago amplo | **alta** | Permission Policy como gate duro · card pra mutação · `disallowedTools` destrutivo cortado · SSH least-privilege por node · audit |
| **Prompt injection** — o cérebro lê conteúdo que pode conter instrução maliciosa e ser induzido a agir | **alta** | O card mostra o **comando literal** → injection vira card negado · nenhuma tool auto-aprovada vaza/muta · toda saída de tool é não-confiável |
| **Exfiltração** — vazar segredo por tool outbound | **alta** | `WebFetch`/`WebSearch`/rede outbound fora do auto-allow — sempre card |
| **Container comprometido = chaves do reino** | **alta** | Container não-root · `~/.ssh` read-only · sem socket Docker · drop de caps · o card ainda segura mutação |
| **Scope creep → god-object** — a ambição de plataforma vira monólito | média | Chassi de módulos · não-objetivos explícitos · releases faseadas |
| **Dependência do perímetro WireGuard** — misconfig quebra a premissa de exposição | média | Defesa em profundidade: bind só no `wg0` + bearer token; o gate da policy segura mesmo se a rede vazar |
| **Bus factor / tempo** — projeto pessoal; complexidade pode passar do tempo disponível | média | MVP pequeno · spec + este doc deixam qualquer agente reconstruir/estender · releases faseadas |

---

## 8. Naming & identidade

- **Tormod** (Þórmóðr, "mente/ânimo de Thor"). Tema nórdico do fleet (`odin` · `saga` · `tormod`).
- **Mark:** cérebro + Mjölnir + raio, minimalista, sobre navy.
- **Paleta "Sinapse & Trovão"** — funde a mente (sinapse) e a força de Thor (trovão). Tokens de tier (`safe`/`approve`/`danger`) mapeiam permissão; o acento de marca é `arc` (azul-relâmpago, ex-`huginn`).
- **Mimir** — o microsserviço de memória/histórico/métricas. Mímir é o ser da sabedoria cuja cabeça Odin consulta por conselho; memória + conhecimento batem com o papel.
