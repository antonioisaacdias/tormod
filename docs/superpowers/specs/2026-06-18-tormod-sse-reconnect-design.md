# Tormod — Reconexão SSE (resync automático + estado de conexão)

Data: 2026-06-18
Status: aprovado (brainstorming) — pronto para plano de implementação
Marco de versão: **0.7.0** (reconexão SSE)

## Objetivo

Fazer o stream de eventos do Tormod **sobreviver a quedas de rede** sem ação manual:
quando a conexão SSE cai (wg pisca, celular troca wifi↔dados, app vai pro background e o
SO mata o socket), o cliente **reconecta sozinho** e **re-sincroniza o estado durável**,
sem perder cards de aprovação e sem deixar o usuário achando que está conectado quando não está.

Hoje o stream é live-only: ao cair, o front só loga `console.error` e fica parado até um
**reload manual**. Em celular sobre wg isso é frequente. Este é o degrau **0.7.0** da escada
para o 1.0.

## Contexto e restrições

- **Transporte:** o front usa **fetch-reader** (`readSSE` em `apps/web/src/lib/api.ts`), não
  `EventSource`, porque precisa do header `Authorization` (auth por cookie no web, por Bearer
  no nativo). Logo **não há auto-reconnect nem Last-Event-ID de graça** — reconexão é manual.
- **Streams existentes** (servidor `apps/server/src/http/app.ts`, Hono `streamSSE`):
  - `/api/sessions/:id/stream` — eventos da sessão (text/thinking deltas, tool_use/result,
    `permission_request`, `result`, `usage`). Ping a cada 15s.
  - `/api/stream` — canal global de `session_status` (idle/working/waiting/closed). Ping 15s.
  - **Sem `id:` nos eventos, sem buffer/replay.** Evento emitido enquanto desconectado some.
- **Estado durável já recuperável:** `getHistory(id)` lê o transcript `.jsonl` (turnos
  concluídos). Cards de aprovação **pendentes** vivem em memória no `SessionManager` mas
  **já são replayados a qualquer novo subscriber** (`manager.ts` `subscribe()` reemite os
  `pending` da sessão; comentário "replayed to subscribers that connect later").
- **Decisão de abordagem (brainstorming):** **resync de estado**, não replay exato por
  Last-Event-ID. Aceita-se perder deltas de digitação ocorridos durante a queda; o estado
  final fica correto e nenhum card de aprovação some. Sem ring buffer no servidor.
- **UX de conexão:** indicador **sutil** (pill "reconectando…"), não banner.

## Arquitetura

Reconexão **100% no cliente**, para os dois streams. Servidor **sem mudança de protocolo**
(subscribe já replaya pendentes; resync usa `/history` + lista já existentes; o ping de 15s
do servidor é reutilizado como batida para o watchdog).

### Fluxo de reconexão

Um wrapper reconectável envolve o loop fetch-reader, com três gatilhos de volta:

1. **Fim/erro de rede** (`reader.read()` retorna `done`, ou `fetch`/leitura lança): espera
   **backoff exponencial** (1s → 2s → 4s → 8s → 16s, **teto 20s**), reseta ao reconectar,
   e reabre o stream.
2. **Watchdog de conexão morta:** timer resetado a cada chunk recebido (inclui o `ping`). Se
   ficar **~35s sem nenhum byte** (> 2× o ping de 15s do servidor), aborta o reader atual e
   força reconexão. Pega o TCP half-open de troca de rede no celular, em que `read()` nunca
   retorna `done`.
3. **`window` `online` e `document` `visibilitychange→visible`:** reconecta imediatamente
   (rede voltou / app voltou pro foreground), curto-circuitando o backoff.

**Para em definitivo** apenas em: `AbortSignal` abortado (unmount / drop de sessão) ou **401**
(→ `UnauthorizedError`, que sobe pro gate de auth existente). Erros não-401 e fim de stream
sempre reconectam.

### Componentes

- **`apps/web/src/lib/sse.ts`** (novo — extraído de `api.ts`): a função reconectável.
  Assinatura aproximada:
  ```ts
  connectSSE<T>(path, {
    onEvent: (e: T) => void,
    onStatus: (s: 'open' | 'reconnecting') => void,
    onReconnect?: () => void,          // chamado a cada reabertura bem-sucedida (≥ 2ª)
    signal: AbortSignal,
  }): Promise<void>
  ```
  Encapsula: parse de frames SSE (reaproveita o split por `\n\n`/linha `data:`), backoff,
  watchdog, listeners de `online`/`visibilitychange`, e a regra de parada (abort/401).
  `streamSession`/`streamAll` em `api.ts` passam a delegar para cá.

- **`useSessionThreads`** (`apps/web/src/hooks/`): a unidade "carrega history + abre stream"
  vira reconectável. A cada **(re)conexão bem-sucedida**: re-`getHistory(id)` → `seedThread`
  (rebuild da thread = fonte da verdade, recupera turnos concluídos durante a queda); o stream
  reaberto replaya o `permission_request` pendente (servidor) e retoma o ao vivo. Atualiza
  `working` a partir do status. Mantém o `AbortController` por sessão já existente.

- **`useSessions`** (`apps/web/src/hooks/`): no `onReconnect` do stream global, re-busca a
  lista (`list()`) para reconciliar os status dos cards (cobre os `session_status` perdidos
  na queda — por isso o servidor não precisa replayar status no subscribe global).

- **Estado de conexão (UI):** estado `connection: 'online' | 'reconnecting'` derivado do
  `onStatus`. Renderiza um **pill discreto "reconectando…"** na statusline do chat; some ao
  voltar `online`. Escala para uma **nota inline** se a reconexão falhar repetidamente
  (≥ N tentativas, ex. N=5). O **composer continua usável** durante a reconexão — sem fila de
  envio (YAGNI); um `sendMessage` que falhar por rede já trata o erro como hoje.

## Casos de borda

- **Idempotência do resync:** re-seed do history + `permission_request` replayado para o mesmo
  `toolUseId` **não pode duplicar** card. Ajustar `foldEvents` para que um `permission_request`
  cujo `toolUseId` já existe na thread **promova** o item existente a card pendente (em vez de
  append). Coberto por teste.
- **Reconnect no meio de um turno:** o transcript pode ainda não conter o turno em voo →
  pequeno gap até ele completar e novos eventos fluírem. Aceito (deltas da queda já concedidos).
  O indicador "trabalhando…" + replay do card pendente mantêm a segurança.
- **401 durante reconexão:** para o loop e sobe `UnauthorizedError` → gate de auth (caminho
  existente). Não fica tentando reconectar com credencial inválida.
- **Múltiplas sessões:** cada stream per-session reconecta de forma independente (map de
  `AbortController` por id já existe). O stream global reconecta separadamente.
- **Backoff não-bloqueante:** a espera de backoff deve ser cancelável pelo `signal` e pelos
  gatilhos `online`/`visible` (não usar `sleep` rígido sem escape).

## Testes

- **Unit (`lib/sse.ts`)** com `fetch` e timers injetados/fake:
  - schedule de backoff (1→2→4→8→16→20 cap) e **reset ao reconectar**;
  - watchdog dispara após `STALE_MS` sem chunk e força reconexão; é resetado por chunk/ping;
  - `online`/`visibilitychange` curto-circuitam o backoff;
  - **para** em abort e em 401 (`UnauthorizedError`); **reconecta** em fim de stream e erro
    não-401.
- **Unit (`foldEvents`)**: `permission_request` para `toolUseId` já presente promove o item
  existente a card (idempotência), sem duplicar.
- **Manual / e2e (celular sobre wg):** derrubar a wg no meio de um stream → pill "reconectando…"
  aparece → restaurar → resync (history + card pendente sobrevive) → ao vivo retoma.

## Fora de escopo (YAGNI)

- Last-Event-ID + ring buffer no servidor (decisão: resync, não replay exato).
- Fila de envio offline / mensagens pendentes enquanto desconectado.
- Replay de `session_status` no subscribe global (refetch da lista cobre).
- Reconexão para o web app além do mesmo caminho (o web usa os mesmos hooks; ganha de graça).

## Stack / arquivos tocados

- Front: `apps/web/src/lib/sse.ts` (novo), `lib/api.ts` (delega), `lib/foldEvents.ts`
  (idempotência), `hooks/useSessionThreads.ts`, `hooks/useSessions.ts`, statusline do chat
  (pill). Testes em `*.test.ts` (vitest já configurado no `apps/web`).
- Back: nenhum (protocolo inalterado).
