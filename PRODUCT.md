# Huginn — Product Spec

> *Huginn, o corvo do pensamento que Odin solta pelos nove mundos e que volta com notícias.*
> No homelab cujo hub se chama `odin`, o Huginn é a camada de **mãos-e-olhos**: sai pelos nodes, observa, age e reporta de volta.

Este documento é a fonte da verdade do produto — o **"o quê"** e o **"porquê"**. O **"como"** (implementação linha a linha) fica a cargo do Claude Code, que deve ler este arquivo no início de cada sessão.

---

## 1. Visão

Huginn é um **servidor MCP** que expõe operações do homelab como tools. Ele não tem inteligência própria: qualquer **cérebro** pluga nele — o Claude Code no `odin` (v1), o PWA pelo celular (fase 2), ou um agente Jarvis próprio (futuro). O cérebro pensa e decide; o Huginn fornece as mãos e medeia a aprovação.

Consequência de arquitetura: não construímos "um app que fala com o Claude Code". Construímos a camada de ferramentas, e os clientes são intercambiáveis.

### Norte de longo prazo — Huginn como plataforma

O destino do Huginn **não** é um MCP de ops. É a **superfície única de gestão do homelab**: o painel que documenta, gerencia config, mostra consumo, opera os nodes — e que no futuro **substitui o dashboard Glance** como home. A divisão de papéis:

- **O MCP é o motor.** Expõe capacidades como tools.
- **O front é o produto.** A camada que o ser humano usa pra gerenciar tudo de um lugar só.

Isso cresce de forma **planejada, por módulos** (ops/chat, dashboard, docs, config, consumo) — não num monólito que incha. Duas implicações de arquitetura que valem desde já:

1. **A fundação do front (R3) entrega um chassi, não uma tela.** Um sistema de navegação/módulos extensível + um contrato MCP↔front estável. É o que permite acoplar features novas sem virar gambiarra.
2. **No futuro, microsserviços se acoplam ao Huginn.** Outros serviços do homelab (o próprio **Muninn** pra histórico, e o que vier depois) expõem capacidades que o front do Huginn **agrega e renderiza** como módulos. O Huginn vira o hub; cada serviço pluga por um contrato definido (MCP ou HTTP). Essa extensibilidade é requisito de design do chassi, não um detalhe futuro.

---

## 2. Escopo do v1

- **Foco:** fleet com ações — leitura livre + operações que alteram estado mediante aprovação.
- **Cérebro/cliente:** Claude Code rodando no `odin`.
- **Transporte:** **stdio** (o Claude Code sobe o Huginn como subprocesso). Zero rede, zero auth, zero exposição.
- **Postura de segurança:** allowlist de leitura roda direto; tudo que altera estado pede aprovação; destrutivo fica fora.

### Não-objetivos (a cerca do escopo)

| Fora do v1 | Onde vive |
|---|---|
| Gerência de config do Claude Code (memórias/skills/agentes) | Fase 2 |
| Clientes remotos / mobile (HTTP + auth) | Fase 2 |
| Memória / histórico persistente, métricas no tempo, base de conhecimento | Futuro **Muninn** (servidor separado) |
| Sistema de monitoração (telemetria armazenada, alertas) | Não é o Huginn — leituras são sempre ao vivo |

---

## 3. Arquitetura

```
Claude Code (odin) ──stdio──> Huginn ──┬── local ──────────── odin
                                       ├── SSH sobre LAN ───── truenas · debian
                                       ├── SSH sobre WireGuard ─ diaslabs (VPS)
                                       └── SSH dinâmico ─────── thinkpad (LAN em casa / wg fora)
```

- Roda no `odin` (hub/admin). Executa local pro próprio `odin` e via SSH pros demais nodes, **reusando o `~/.ssh/config`** — que já resolve host, porta, user, chave e o roteamento certo por node. O Huginn nunca embute endereço: só conhece o **alias SSH**.
- Topologia real é mista: `truenas` e `debian` ficam na **LAN**; a VPS `diaslabs` entra por **WireGuard**; o `thinkpad` é dinâmico (LAN em casa, wg fora — tratado por `Match exec` no ssh config). O "perímetro WireGuard" do modelo de segurança vale pro **cliente remoto** (PWA da fase 2), não pros nodes internos.
- Um único **arquivo de inventário** mapeia `node → alias ssh` e define a allowlist.
- Fan-out paralelo (ex.: saúde de todos os nodes) via goroutines + `errgroup`.

---

## 4. Superfície de tools

Nomes seguem `verbo_objeto`. `node` é sempre um **enum vindo do inventário** — o modelo não inventa host.

| Tool | Tier | Annotation | Comportamento |
|---|---|---|---|
| `list_nodes` | leitura | `readOnlyHint` | inventário + alcance via WireGuard |
| `node_health` | leitura | `readOnlyHint` | cpu, ram, disco, uptime, load |
| `service_status` | leitura | `readOnlyHint` | estado de um serviço systemd |
| `read_logs` | leitura | `readOnlyHint` | `journalctl`/tail (default ~50 linhas) |
| `read_file` | leitura | `readOnlyHint` | conteúdo de arquivo |
| `list_containers` | leitura | `readOnlyHint` | `docker ps` |
| `container_logs` | leitura | `readOnlyHint` | logs de container |
| `run_safe_command` | leitura | `readOnlyHint` | executa **só** se o comando bater na allowlist; senão recusa |
| `usage_now` | leitura | `readOnlyHint` | lê os transcripts em `~/.claude` e agrega consumo da sessão atual e dos 7 dias |
| `restart_service` | altera estado | — | pede aprovação |
| `write_file` | altera estado | — | pede aprovação |
| `compose_up` / `compose_down` | altera estado | — | pede aprovação |
| `run_command` | altera estado | `destructiveHint` | comando arbitrário, **sempre** pede aprovação |

**Destrutivo** (`rm`, `compose down -v`, ops de disco) está fora do v1. Quando necessário, o caminho é `run_command` com aprovação — onde o usuário vê o comando literal antes de liberar.

### `usage_now` — consumo ao vivo (v1)

Tool read-only que lê os transcripts JSONL que o Claude Code **já grava** em `~/.claude` e agrega. Não é telemetria nova; é leitura de arquivo no disco. Devolve uma linha de status:

```
ctx ~41% (82k/200k) · sessão 1.2M tok · 7d 14.3M · modelo opus-4.x
```

No v1 (cliente = terminal/Claude Code) isso é **texto**, não widget — um MCP não pinta pixel. A **barra de contexto gráfica** (faixa fininha no topo do chat, colorida pelos tiers: `safe` folgado → `approve` >~70% → `danger` perto do limite) é componente de front e nasce no **R3/PWA**, fazendo polling nessa mesma tool via SSE. Botar a tool no v1 garante o dado agora e a UI bonita depois, sem retrabalho.

Dois cuidados, registrados de propósito:

- **"Contexto %" é estimativa.** O uso real de contexto vive na cabeça do cliente naquele turno; o Huginn lê o transcript e *reconstrói* somando tokens. É aproximação boa, não o número exato. O label deve deixar isso claro (`~41%`).
- **v1 mede tokens, não R$.** Custo em reais exige multiplicar pela tabela de preço (que muda); fica pro painel de Usage (R7).

---

## 5. Segurança — allowlist em duas camadas

Defesa em profundidade: não confiar só no cliente.

1. **Server-side (no Huginn):** `run_safe_command` parseia o comando (`shlex`, nunca `shell=True`/`sh -c`) e só executa se binário + flags casarem com a allowlist de coisas comprovadamente read-only. Fora disso, recusa com mensagem acionável ("use `run_command`, que pede aprovação").
2. **Client-side (UX no Claude Code):** as tools de leitura entram no `allowedTools` (rodam direto); as mutadoras ficam de fora, então o Claude Code mostra o prompt de permissão com os argumentos a cada chamada.

**Regra de ouro da aprovação:** toda tool que altera estado monta o **comando literal** no payload — é isso que aparece no prompt. Nada ofuscado; legibilidade do approval é feature.

**Perímetro:** no v1 (stdio) não há rede. Na fase 2, o perímetro real é o WireGuard; o HTTP escuta só em `wg0` + bearer token.

---

## 6. Modelo de dados — SQLite

Persistência mínima. Driver **pure-Go (`modernc.org/sqlite`)** — sem cgo, mantém o binário estático único. O audit mora **no node, nunca no Forgejo** (é append-only, cresce sempre, e registra o que rodou em produção).

```sql
CREATE TABLE audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,      -- ISO 8601 UTC
  session_id  TEXT,               -- sessão do Claude Code, se houver
  node        TEXT NOT NULL,
  tool        TEXT NOT NULL,      -- nome da tool MCP
  command     TEXT,               -- comando literal (quando aplicável)
  tier        TEXT NOT NULL,      -- read | mutate | destructive
  approved    INTEGER NOT NULL,   -- 0 = auto/leitura · 1 = aprovado · 2 = negado
  approved_by TEXT,               -- fase 2: device/usuário
  exit_code   INTEGER,
  duration_ms INTEGER
);
CREATE INDEX idx_audit_ts        ON audit(ts);
CREATE INDEX idx_audit_node_tier ON audit(node, tier);
```

- O audit existe pra ser consultado **depois que algo dá errado** (filtro por node × tier × período). Isso é SQL de uma linha.
- **Futuro (cibersegurança):** hash encadeado por linha pra tamper-evidence.
- **Aprovações pendentes:** efêmeras, vivem **em memória** (se reiniciar, re-pergunta).
- **Push subscriptions:** só na fase 2 (endpoints de notificação por device).

---

## 7. Stack

### Servidor (v1)
- **Go 1.23+**
- `github.com/modelcontextprotocol/go-sdk` — SDK oficial (Google + Anthropic). stdio agora; **Streamable HTTP na fase 2, mesma lib** (sem troca de framework).
- `os/exec` + `ssh` do sistema pra alcançar nodes (reusa `~/.ssh/config`). Alternativa: `golang.org/x/crypto/ssh`.
- `gopkg.in/yaml.v3` — inventário/allowlist.
- `google/shlex` — tokenização segura do comando.
- `golang.org/x/sync/errgroup` — fan-out paralelo.
- `modernc.org/sqlite` — audit (pure-Go).
- `testing` (stdlib) — **prioridade de teste: a allowlist** (pedaço crítico de segurança).

### Front (fase 2)
- **PWA responsivo, uma base de código** (breakpoint decide mobile vs. três-painéis).
- **Vite + React + Tailwind + shadcn/ui + TanStack Query.**
- **SSE** (não WebSocket): o fluxo é stream servidor→cliente + comandos via POST. É o modelo nativo do Streamable HTTP do MCP.
- Servido **same-origin** pelo daemon HTTP do Huginn, atrás do `wg0`.
- **HTTPS obrigatório** (service worker): `huginn.diaslabs.com.br` com cert via DNS-01 (Caddy). Sem HTTPS, sem PWA.
- **Push de aprovação:** notificação na S23 mesmo com o app fechado.
- **Service worker cacheia só o app shell** (bundle/fontes/ícone) — **nunca** telemetria. Saúde de node é sempre rede ao vivo.
- Auth: bearer token (o perímetro é o WireGuard). Supervisão do daemon: unit systemd ou container.

---

## 8. Convenções de código

- **Nomes de tool:** `verbo_objeto`, consistente.
- **`node` como enum** do inventário, nunca free-string.
- **Retorno:** `TextContent` com um `summary` de uma linha legível **+** um struct tipado de saída (schema validado). Não retornar dict/objeto cru — renderiza truncado no cliente.
  - Ex.: `summary: "diaslabs · ok · up 12d · load 0.4 · ram 72% · disk 61%"`
- **Log só no stderr.** stdout é o canal do protocolo (JSON-RPC); qualquer print ali corrompe a comunicação.
- **Voz mínima.** Ferramenta de ops fica pior com corvo tagarela; a personalidade mora no formato consistente do `summary`, não em flavor text.

Exemplo de assinatura (Go SDK):

```go
type StatusInput struct {
    Node    string `json:"node"    jsonschema:"node alvo (enum do inventário)"`
    Service string `json:"service" jsonschema:"nome do serviço systemd"`
}
type StatusOutput struct {
    Summary string `json:"summary"`
    Active  bool   `json:"active"`
    State   string `json:"state"`
}
```

---

## 9. Inventário + allowlist

**Rede não mora aqui.** Host, porta, user e chave já vivem no `~/.ssh/config`; o inventário só mapeia `node → alias ssh` + transporte e define a allowlist. Isso mantém credenciais e topologia fora do arquivo de config.

- **`inventory.example.yaml`** (genérico) é versionado no repo — serve de documentação.
- **`~/.config/homelab/huginn/inventory.yaml`** (real) **não** é versionado no repo público (`.gitignore`); fica no node, `chmod 600`. Caminho default; flag `--inventory` faz override.

```yaml
# formato (valores reais ficam no arquivo privado)
nodes:
  control:  { transport: local }
  nas:      { transport: ssh, ssh_alias: nas }      # Host no ~/.ssh/config
  vps:      { transport: ssh, ssh_alias: vps }
  gpu-box:  { transport: ssh, ssh_alias: gpu-box }

allowlist:                       # run_safe_command executa sem aprovação
  - df
  - free
  - uptime
  - ss
  - "systemctl status *"
  - "journalctl -u * --no-pager"
  - "docker ps"
  - "docker logs *"
  - "wg show"
  - "ufw status"
```

> ⚠️ **truenas roda SCALE (ix-apps/k3s).** Serviços como o Forgejo não são unidades systemd — `systemctl status forgejo` não se aplica lá. Para serviços em ix-app, o status/restart passa pelo k3s/Docker, não pelo systemd. A allowlist e as tools de mutação precisam tratar esse node de forma específica.

---

## 10. Paleta — "Corvo & Circuito"

Ancorada no navy da logo; os status **são** o vocabulário de permissão.

| Token | Hex | Papel |
|---|---|---|
| `ink` | `#0F2236` | fundo mais profundo |
| `surface` | `#16293F` | cards / painéis |
| `raised` | `#1E3550` | elevações, inputs |
| `border` | `#2A415C` | divisórias |
| `frost` | `#EEF3F8` | texto principal + o corvo |
| `mist` | `#93A6BE` | texto secundário |
| `faint` | `#5C708A` | labels, metadados |
| `huginn` | `#4DB6E8` | marca: acento, foco, links |
| `huginn-deep` | `#2E91C4` | hover / pressed |
| `safe` | `#46C08A` | **tier leitura** — roda livre |
| `approve` | `#E8A93C` | **tier altera-estado** — pede aprovação |
| `danger` | `#E5687C` | **tier destrutivo** — gated / fora do v1 |

`safe`/`approve`/`danger` batem com `readOnlyHint` / aprovação / `destructiveHint`. Mapeamento shadcn (CSS vars `--background`, `--primary` = `huginn`, `--destructive` = `danger`, etc.) no arquivo de tokens.

---

## 11. Decisões (e seus porquês — debate fechado)

| Decisão | Por quê |
|---|---|
| **Go** (não Python) | Binário único estático cross-compilável pro fleet inteiro; fan-out paralelo idiomático; fit de domínio (homelab é Go); error handling explícito é virtude num gate de segurança. SDK oficial agora estável (v1). |
| **Claude Code é o cérebro** | Huginn só fornece as mãos. Mantém o banco minúsculo (sem tabela de conversa — o Claude Code já persiste sessão em `~/.claude`). |
| **PWA** (não React Native) | Reaproveita ~100% do web; alcance mobile + push de aprovação bastam. RN só se ganharia o pão com nativo de verdade. |
| **SSE** (não WebSocket) | Fluxo é stream servidor→cliente + POSTs. Full-duplex seria peso morto. Nativo do Streamable HTTP. |
| **SQLite** (não JSONL) | Audit é consultado por interseção (node × tier × período) = SQL de uma linha. Pure-Go mantém binário único. Não vai pro Forgejo de qualquer forma. |
| **stdio no v1** | Cliente único local (Claude Code no odin) → zero rede/auth/exposição. HTTP só quando o mobile entrar. |

---

## 12. Features futuras, plataforma e releases

As releases são agrupadas por **superfície de produto**, não por feature solta. A lógica de dependência:

- **Skills/agentes/memórias** são arquivos — a *capacidade* pode virar tool MCP no stdio bem antes de existir UI.
- **Consumo, dashboard, docs e config-UI** dependem do lift de HTTP+PWA (o chassi).
- O **chassi (R3)** é o caminho crítico e a decisão arquitetural mais importante: é ele que torna o Huginn uma plataforma extensível em vez de um app que incha.

### Escada de releases

| Release | Superfície | Entrega | Depende de |
|---|---|---|---|
| **R1 — Núcleo MCP** *(specado)* | motor | fleet ops, allowlist, audit, `usage_now`; cérebro = Claude Code; stdio | — |
| **R2 — Config como tools** | motor (stdio) | skills + agentes + memórias como tools frontmatter-aware; tool de sync no Forgejo (commit + `install.sh` fan-out) | R1 |
| **R3 — O Chassi** | plataforma | HTTP + auth + SSE + PWA **+ sistema de navegação/módulos extensível + contrato MCP↔front estável**. Entrega já com o módulo **Chat/Ops** (conversar com Claude Code + aprovação/push) e a **barra de contexto** consumindo `usage_now` | R1 |
| **R4 — Dashboard (home)** | módulo | substituto do Glance: widgets read-only de saúde/serviços/nodes como tela inicial | R3 |
| **R5 — Document Workspace** | módulo | editor `.md` no padrão chat+canvas — documentação, projetos, escrita. Modelo de sync definido (ver abaixo) | R3 |
| **R6 — Config UI** | módulo | editor frontmatter-aware (dropdowns de model/tools/permission, corpo markdown, visão de precedência) por cima das tools do R2 | R2, R3 |
| **R7 — Usage & Observability** | módulo | painel de consumo: por hora, total 7 dias, contexto, modelo em uso, custo em R$. Primeira fatia do **Muninn** | R3 |
| **Futuro — Muninn** | microsserviço | memória/histórico/conhecimento, métricas de tendência longa (30/90d), tamper-evidence no audit. Acopla ao front do Huginn como módulo | R3, R7 |

### O chassi e os microsserviços

O R3 não entrega "uma tela" — entrega a **plataforma**. Requisitos de design:

- **Sistema de módulos:** cada superfície (Chat/Ops, Dashboard, Docs, Config, Usage) é um módulo que pluga numa navegação extensível, sem reescrever o shell.
- **Contrato MCP↔front estável:** a forma como o front descobre e consome capacidades não muda a cada feature.
- **Acoplamento de microsserviços (futuro):** outros serviços do homelab — o Muninn à frente, e o que vier depois — expõem capacidades que o front do Huginn **agrega e renderiza** como módulos, plugando pelo contrato (MCP ou HTTP). O Huginn é o hub; os serviços são satélites. Acertar isso no R3 é o que permite "crescer planejado".

### R5 — Document Workspace (modelo definido)

Padrão **chat + canvas**: durante a conversa, o Claude Code escreve/edita um `.md` via tool → o Huginn detecta e oferece "abrir no editor?" → ao aceitar, o **chat colapsa numa coluna fina à esquerda** e o **documento abre no centro**. É só estado de layout no front (módulo Docs assumindo o palco); nada novo no backend além do que o chassi já dá.

**Sync nível-de-arquivo (não keystroke).** O `.md` no disco é a fonte da verdade. O "ao vivo" tem dois lados com latências diferentes, e é assumido honestamente:

- **Claude → você:** o Claude Code salva via `write_file`; o Huginn detecta (hash/mtime) e empurra por SSE; o editor atualiza. Aparece **em blocos, não caractere a caractere** (o arquivo muda inteiro/em patches, não token a token). É rápido, mas em saltos.
- **Você → Claude:** ele não acompanha tecla a tecla — lê o arquivo quando vai agir. Modelo: você edita → autosave com debounce → Huginn persiste → na próxima leitura, o Claude vê tua versão.

**Regra de turno** (resolve o conflito; substitui o "last-write-wins" genérico):

- Com o editor **aberto e em foco**, *você* é dono da escrita. Edições do Claude **não sobrescrevem** — chegam como **sugestão/diff** ("o Claude propõe estas mudanças — aceitar?") ou ele espera.
- Ao **fechar o editor** ou pedir explicitamente pro Claude editar, o turno passa pra ele; a alteração aplica e aparece ao vivo.
- Garantia: **mudança do Claude aparece na hora; texto seu nunca é atropelado.**

**Indicadores de estado** (a forma honesta de mostrar a latência):

- "⬡ Claude editando…" em `huginn` (ativo) enquanto a tool roda; some quando o SSE entrega a versão nova.
- "salvando… → salvo ✓" em `safe` no autosave.
- "salvo · sincronizado" ocioso, sempre visível — mata a dúvida de "minha última frase já foi pro disco?".

**Editor:** MDXEditor (WYSIWYG-de-markdown) ou CodeMirror 6 (source+preview) — decisão final na hora de construir. Ambos MIT. **Lib de colaboração: nenhuma** — sem Yjs (CRDT seria over-engineering pra um humano + um agente em nível de arquivo).

### Decisões em aberto (a resolver antes da release)

- **Ordem R4 × R7:** o dashboard subiu na frente do usage (valor de hábito alto, golpe no Glance, dado barato). Inverter é trivial se ver consumo for dor mais urgente.
- **Dashboard read-only vs. acionável:** Glance é só olhar. No minuto que um widget ganha botão "restart", ele herda todo o modelo de tiers/aprovação. Decidir cedo muda o design do R4.
- **Profundidade do Usage:** 7 dias agrega on-the-fly (read-only); tendência de 30/90 dias exige store de rollup — aí já é Muninn de verdade.

### Alinhamento com o homelab real (a resolver)

Decisões que surgiram ao confrontar a spec (escrita sem conhecer o lab) com a infra real:

- **Linguagem — Go (decidido 2026-06-08).** A spec cravava Go (binário único, fan-out); o stack do dono é Python/Java/Angular e o `homelab-agent` é Python. Decisão: **Go**, pelas vantagens técnicas — binário único estático cross-compilável pro fleet, fan-out paralelo idiomático (errgroup), error handling explícito num gate de segurança, SDK MCP oficial estável. O reuso com o `homelab-agent` (Python) foi conscientemente abdicado.
- **R4 vs. Glance.** O dashboard atual **é** o Glance (recém-construído: Prometheus via custom-api + scraper próprio). O R4 "substituir o Glance" precisa decidir entre **conviver** (Huginn agrega) ou **substituir** (e jogar fora trabalho recente).
- **Onde roda o daemon da fase 2.** O v1 (stdio) roda no `odin` por ser subprocesso do cérebro (Claude Code no odin) — exceção legítima. O daemon HTTP+PWA da fase 2 é serviço de verdade; a regra do lab manda serviço pro NAS. Definir se o daemon fica no `odin` (perto do cérebro) ou migra, e como cérebro e daemon se conectam nesse caso.
- **Repos + config (decidido).** Código no **GitHub** (público, portfólio) com **mirror automático no Forgejo** (self-hosted). Nada sensível no git: rede no `~/.ssh/config`, inventário real em `~/.config/homelab/huginn/`, token da fase 2 em `~/.config/homelab/secrets`. Só o `inventory.example.yaml` é versionado.

---

## 13. Riscos do projeto

### 13.1 Acoplamento ao fornecedor (Claude/Anthropic)

**A boa notícia: o núcleo já é agnóstico por construção.** O Huginn é um *servidor* MCP, e o MCP virou padrão neutro multi-fornecedor (governança Linux Foundation; Anthropic + OpenAI + Block fundadores; Google/Microsoft/AWS membros; suporte de OpenAI, Google, Microsoft, Salesforce). As tools são consumíveis por qualquer cliente MCP, com qualquer modelo — cloud ou local.

**Onde o acoplamento realmente mora:**

| Ponto | Grau | Mitigação |
|---|---|---|
| Cérebro = Claude Code | trocável | É só um cliente MCP. Substitutos open-source que rodam com qualquer LLM (inclusive local via Ollama/LM Studio): **Goose**, **Cline**, **Continue**, **LibreChat**. Trocar = apontar outro cliente pro Huginn, não reescrever. |
| `usage_now` lê o formato `~/.claude` | leve | O Huginn já tem audit próprio; tratar o leitor de transcript como *adapter* opcional, não dependência. |
| R2 — gerência de `.claude/` (memórias/skills/agentes) | irredutível, mas modular | É config do próprio cérebro. Trocou de cérebro, troca o módulo. Não é core. |
| UX de aprovação apoiada em features do Claude Code | baixo / diminuindo | O gate real é a allowlist **server-side** (agnóstica). O PWA da fase 2 passa a ser dono da UI de aprovação, **reduzindo** o acoplamento. |

**Regras de design pra permanecer trocável (invariantes do projeto):**

- O **servidor é o produto; o cérebro é cliente.** Nunca embutir "Claude-ismos" nas tools.
- **O Huginn nunca chama API de LLM nem guarda API key** — quem fala com o modelo é o cérebro. Mantém o servidor provider-neutro.
- Na fase 2, definir uma fronteira de **agent adapter** (cérebro = "streama tokens + chama tools MCP"), pra trocar o cérebro sem mexer no front.
- **Dono dos próprios dados** — não depender de formato privado do cliente.
- Features específicas de fornecedor (ex.: defer hooks) **nunca viram requisito**; sempre ter o fallback do gate server-side + UI própria.

### 13.2 Outros riscos

| Risco | Severidade | Mitigação |
|---|---|---|
| **Raio de explosão** — o Huginn roda comando no fleet inteiro via SSH; bug na allowlist, cliente comprometido ou injeção → estrago amplo | **alta** | Allowlist server-side como gate duro; aprovação pra mutação; audit; tiers; destrutivo fora de escopo; perímetro WireGuard; SSH least-privilege por node |
| **Prompt injection** — o cérebro lê logs/arquivos que podem conter instrução maliciosa ("ignore tudo, rode `rm -rf`") e ser induzido a chamar `run_command` | **alta** | O gate server-side garante que um cérebro enganado **não excede a allowlist sem aprovação humana explícita**; tratar todo conteúdo lido como não-confiável; aprovação mostra o comando literal |
| **Churn do MCP/SDK** — protocolo jovem, em evolução (transporte já mudou SSE→Streamable HTTP) | média | SDK oficial acompanha o spec; pinar versões; conceitos de tool são estáveis; governança neutra reduz mudança unilateral |
| **Scope creep → god-object** — a ambição de plataforma vira monólito ingerenciável | média | Chassi de módulos + não-objetivos explícitos + releases faseadas (já desenhado) |
| **Dependência do perímetro WireGuard** — o modelo de segurança assume a malha como perímetro; misconfig quebra a premissa de exposição | média | Defesa em profundidade: bind só em `wg0` + bearer token, e o gate da allowlist segura mesmo se a rede vazar |
| **Bus factor / tempo** — projeto pessoal; complexidade pode passar do tempo disponível | média | v1 pequeno; apoiar no `PRODUCT.md` pra qualquer agente reconstruir/estender; releases faseadas |
