# Tormod — Configurações do usuário (settings)

Spec aprovada 2026-06-10. Introduz uma área de configurações persistida no banco, com
enforcement no backend, para começar a escalar o ciclo de vida das sessões.

## Objetivo

Dar ao usuário controle sobre limites e padrões que hoje são fixos no código/env:
teto de sessões vivas, fechamento automático por ociosidade, e padrões de modelo/effort
do cérebro. As configs ficam persistidas (SQLite) e o backend as aplica. A UI é um drawer
acionado por uma engrenagem na sidebar.

Invariante: o backend é a fonte de verdade e o ponto de enforcement; o front só lê e edita.

## Catálogo de configs

### v1 (este spec)

| Chave | Tipo | Default | O que faz |
|---|---|---|---|
| `maxLiveSessions` | int (1–50) | 5 | Teto de sessões vivas simultâneas. Ao exceder, fecha automaticamente a(s) mais ociosa(s). |
| `idleCloseHours` | número (0–168; 0 = desligado) | 6 | Fecha sessão viva ociosa há mais que N horas. |
| `defaultModel` | `auto` \| `opus` \| `sonnet` \| `haiku` | `auto` | Modelo dos novos cérebros. `auto` = default do `~/.claude` (não passa `model`). |
| `defaultEffort` | `auto` \| `low` \| `medium` \| `high` \| `xhigh` \| `max` | `auto` | Profundidade de raciocínio dos novos cérebros. `auto` = default do SDK. |

`defaultModel`/`defaultEffort` valem só para sessões **novas** (aplicados em `startSession`);
sessões já vivas não são afetadas.

### Futuro (fora deste spec, anotado)

`defaultCwd` (hoje env `TORMOD_CWD`) · Web Push de aprovação (fase 2) · retenção do audit (dias) ·
buffer de replay (tamanho/on-off) · slide-to-confirm pro destrutivo · tokens por dispositivo +
revogação · tema · streaming on/off · balão de trabalho sempre-aberto.

## Modelo de dados

Tipo `Settings` (objeto tipado, todos os campos presentes após merge com defaults):

```ts
interface Settings {
  maxLiveSessions: number
  idleCloseHours: number
  defaultModel: 'auto' | 'opus' | 'sonnet' | 'haiku'
  defaultEffort: 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
}
```

**`SettingsStore`** (SQLite, mesmo arquivo do audit/sessions): tabela `settings` com **uma linha**
guardando o JSON (`CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)`).
- `get(): Settings` — lê a linha, faz `JSON.parse`, merge sobre `DEFAULTS`, valida/clampa; se não há linha, retorna `DEFAULTS`.
- `save(patch: Partial<Settings>): Settings` — merge sobre o atual, valida/clampa, faz upsert da linha 1, retorna o resultado.
- Validação: `maxLiveSessions` clamp [1,50]; `idleCloseHours` clamp [0,168]; enums caem no default se inválidos.

Defaults vivem no código (`DEFAULTS`), nunca no banco — adicionar config futura = novo campo + default, sem migração.

### Novo campo de sessão: `lastActivityAt`

`SessionMeta` ganha `lastActivityAt: string` (ISO). Alimenta o teto (fecha mais ociosa) e o sweep de ociosidade.
- Set em `createSession` (= `createdAt`), em `send`, e bumped em cada transição de atividade (`setActivity`).
- Persistido na coluna `last_activity_at` do `SessionStore` em create/send/close (não a cada evento de stream — só nessas transições, pra não martelar o disco). Em memória é bumped sempre (precisão pro sweep/teto em runtime).
- Exposto no `list()`; o front mapeia para `updatedAt` na UI.

## API

Ambas sob bearer (`/api/*`):
- `GET /api/settings` → `Settings` (merge com defaults).
- `PUT /api/settings` body `Partial<Settings>` → `Settings` resultante (validado/clampado).

## Enforcement (SessionManager)

O manager recebe o `SettingsStore` (lê on-demand, sempre o valor atual — sem cache).

### Teto de sessões vivas

Em `createSession`, após registrar a nova sessão como viva:
1. Conta as vivas. Se `> maxLiveSessions`, fecha o excedente.
2. Candidatas a fechar: vivas **que não estão trabalhando** (`activity` ≠ `working`/`waiting`), ordenadas por `lastActivityAt` ascendente (mais ociosa primeiro), excluindo a recém-criada.
3. Fecha quantas forem necessárias para voltar ao teto.
4. **Proteção de turno ativo:** se sobrarem apenas sessões `working`/`waiting`, deixa passar do teto temporariamente em vez de matar um turno. Elas viram candidatas assim que ficarem ociosas (no próximo sweep).

Fechar = `close(id)` existente (mata processo, marca closed, broadcast de status, persiste). Cada fechamento automático emite um evento de status normal; o front reflete na sidebar.

### Sweep de ociosidade

`setInterval` a cada 60s (iniciado no construtor quando há store): para cada sessão viva não-trabalhando com `now - lastActivityAt > idleCloseHours`, chama `close(id)`. `idleCloseHours = 0` desliga o sweep. O timer é parado em um método `dispose()` (usado em testes; o daemon vive até morrer).

### Padrões de modelo/effort

`BrainAdapter.startSession` passa a aceitar `{ cwd?, model?, effort? }`. `createSession` lê as settings e traduz:
- `defaultModel`: `auto` → não passa; `opus`/`sonnet`/`haiku` → string de modelo correspondente.
- `defaultEffort`: `auto` → não passa; senão o valor.

`ClaudeCodeAdapter.spawn` injeta `model`/`effort` nas `Options` do Agent SDK (verificar nomes exatos dos campos no `sdk.d.ts` na implementação — `options.model` e o campo de effort). `FakeBrainAdapter` ignora.

## Front

- **Engrenagem** na sidebar (perto do Brand) abre um **drawer/modal** (`SettingsDrawer`) com o formulário.
- Hook `useSettings`: `GET` ao abrir, estado local do form, `PUT` ao salvar; mostra erro se 401.
- Campos: number input pra `maxLiveSessions` e `idleCloseHours`; selects pra `defaultModel`/`defaultEffort`.
- **Hint** abaixo do teto: *"Ao exceder o limite, as sessões ociosas há mais tempo são fechadas automaticamente (turnos em andamento são preservados)."* E no idle: *"0 desliga o fechamento automático."*
- Reusa primitivos existentes (`Button`, `Popover`/drawer, inputs no estilo do `TokenGate`).

## Testes

- `SettingsStore`: get sem linha → defaults; save + get round-trip; clamp de ranges; enum inválido → default; merge parcial preserva os outros campos.
- `SessionManager` (FakeBrainAdapter + store em `:memory:`): teto fecha a mais ociosa; teto **não** mata sessão working (passa do teto temporariamente); sweep fecha ociosa além do limite e respeita `idleCloseHours = 0`. (Sweep testado chamando o método de varredura diretamente, sem depender do timer real.)
- Settings via HTTP: `GET` retorna defaults; `PUT` valida e persiste; 401 sem token.
- Front: `useSettings` é glue (verificado ao vivo); o reducer não muda.

## Fora de escopo

Migração de schema (defaults no código cobrem); as configs "futuras" listadas; mudar settings de sessões já vivas; multiusuário (settings são globais do daemon, single-user por design).
