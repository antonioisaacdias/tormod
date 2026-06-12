# Tormod — Auth single-user (sessão stateful + 2FA adaptativo por origem)

Data: 2026-06-11
Status: aprovado (brainstorming) — pronto para plano de implementação

## Objetivo

Substituir o bearer token estático (`TORMOD_TOKEN` + `TokenGate`) por um sistema de
autenticação real **single-user**:

- No primeiro setup, o app pede o **cadastro** do único usuário (username, email, senha).
- Depois, login por **username + senha**.
- **2FA (TOTP) adaptativo por origem de rede**: acesso local (LAN/VPN) ignora o 2FA;
  acesso externo (via proxy público) exige o código de 6 dígitos.
- O token estático sai de vez.

Desenhado para aguentar **exposição futura à internet** sem depender de terceiros
(Auth0/OAuth/Cloudflare), seguindo OWASP (Broken Auth, XSS, CSRF, Brute Force).

## Contexto e restrições

- **Shape:** 1 daemon Node (Hono) + SQLite (`tormod-audit.db`), **1 usuário**, PWA.
  Não há escala horizontal — statelessness do JWT não compraria nada; statefulness
  compra **revogação instantânea**. Por isso: **sessão stateful**, não JWT.
- **Borda:** exposição externa será **sempre** atrás de um reverse proxy confiável
  (NPM/Caddy no node `diaslabs`) com TLS — isso é infra (Plano 5 de deploy), **fora
  desta spec**. Esta spec assume que esse proxy existe quando houver acesso externo.
- **Zero dependência de IdP de terceiros.**

## Decisões (com porquês)

| Decisão | Escolha | Porquê |
|---|---|---|
| Identificador de login | **username** | Email é metadado (futuro reset). |
| Modelo de sessão | **stateful, cookie httpOnly** | 1 daemon + SQLite → revogação instantânea, nada em JS pra XSS roubar, SSE não precisa anexar token. |
| Hashing de senha | **Argon2id** (`@node-rs/argon2`) | Padrão-ouro anti-GPU/ASIC; binário pré-buildado (sem compilador). |
| 2FA | **TOTP adaptativo por origem** | Local (LAN/VPN) = só senha; externo = senha + código. |
| Token estático | **removido** | Requisito "sem ter que usar mais o token". |
| Deps novas | `@node-rs/argon2`, `otplib`, `qrcode` | Argon2id, TOTP, geração de QR no backend. |

## 2FA adaptativo por origem — o coração da feature

### Detecção de origem
O servidor calcula o **IP efetivo do cliente**:
- Por padrão, o peer do socket TCP.
- **Se** a requisição vem do **IP do proxy confiável** (`TORMOD_TRUSTED_PROXY`), usa o
  IP mais à esquerda do `X-Forwarded-For` como IP do cliente.
- O IP efetivo é comparado contra os **CIDRs confiáveis** (`TORMOD_TRUSTED_CIDRS`,
  default `192.168.0.0/24,10.0.0.0/24,127.0.0.1/32,::1/128`).
- IP efetivo ∈ CIDRs confiáveis → **local**; senão → **externo**.

### Invariante de segurança (não-negociável)
A app **só pode ser alcançável de fora através do proxy confiável** — nunca
port-forward cru pra ela. `X-Forwarded-For` só é honrado quando o peer do socket é o
`TORMOD_TRUSTED_PROXY`. Sem isso, um atacante externo poderia forjar um IP de origem
na faixa confiável e pular a 2FA. Esta é a premissa que sustenta o gate adaptativo.

### Regras do gate (enforce server-side; o front só reflete)
1. **TOTP precisa estar enrolado para haver acesso externo.** Se a origem é externa e
   o usuário ainda **não** configurou 2FA → login externo **negado** com mensagem
   "configure 2FA conectado pela LAN/VPN antes de acessar externamente". Trava: não dá
   pra entrar de fora sem ter passado pelo enroll de dentro.
2. **Local:** valida só a senha (ignora TOTP mesmo se enrolado).
3. **Externo + 2FA on:** valida senha **e** código **juntos**; falha de qualquer um
   retorna erro **genérico** ("credenciais inválidas") — sem revelar se a senha estava
   certa (anti-enumeração).
4. **Enroll/confirm/disable de TOTP** exigem sessão autenticada **e** origem **local**.

### Sinal pro front
`GET /api/auth/status` → `{ registered, external, totpEnabled }`:
- `external && totpEnabled` → front mostra o campo de 6 dígitos no login.
- `external && !totpEnabled` → front mostra aviso e desabilita o login externo.
- local → só senha.

(O front apenas reflete; o servidor enforça as 4 regras independentemente do front.)

## Arquitetura

### Backend — novo módulo `src/auth/`
Nomes prefixados `Auth*` / tabela `auth_sessions` para **não colidir** com o
`SessionManager`/`SessionStore` do chat (que são sessões de conversa, conceito distinto).

- **`users.ts` — `UserStore`** (SQLite, tabela `users`, no máx. 1 linha):
  - Colunas: `id, username, email, pw_hash, totp_secret (nullable), totp_enabled (0/1), created_at`.
  - Métodos: `hasUser()`, `create({username,email,passwordHash})`, `get()`,
    `verifyPassword(username, password)`, `setTotpSecret(secret)`, `enableTotp()`,
    `disableTotp()`.
- **`authSessions.ts` — `AuthSessionStore`** (tabela `auth_sessions`):
  - O id da sessão é 32 bytes aleatórios; o DB guarda **só o SHA-256** do id (se o DB
    vazar, os ids não são reconstruíveis).
  - Colunas: `id_hash, created_at, expires_at, last_seen`.
  - Métodos: `issue() → {id, expiresAt}` (retorna o id cru uma vez), `validate(id)`,
    `touch(id)` (atualiza `last_seen`, sliding opcional), `revoke(id)`, `revokeAll()`.
  - TTL configurável (`TORMOD_SESSION_TTL_DAYS`, default 30); sweep de expirados.
- **`password.ts`** — wrapper `@node-rs/argon2`: `hash(pw)` / `verify(hash, pw)` com
  params altos (memoryCost/timeCost). Argon2id embute salt+params na string.
- **`totp.ts`** — `otplib`: `generateSecret()` (base32), `otpauthUri(username, secret)`,
  `verify(token, secret)`; `qrDataUrl(uri)` via `qrcode`.
- **`origin.ts`** — `resolveClientIp(req, {trustedProxy})` + `isLocal(ip, {trustedCidrs})`.
- **`throttle.ts`** — rate limit in-memory:
  - **Por IP:** máx. 5 tentativas/min → bloqueia o IP por 15 min.
  - **Por username:** 5 falhas seguidas → lock da conta por 10 min.
- **`config.ts`** — lê env: `TORMOD_TRUSTED_PROXY`, `TORMOD_TRUSTED_CIDRS`,
  `TORMOD_COOKIE_SECURE` (default true; **false** no dev http da LAN),
  `TORMOD_SESSION_TTL_DAYS`.

### Rotas — `src/http/auth.ts` (montadas em `/api/auth/*`, públicas exceto onde dito)
- `GET  /api/auth/status` → `{ registered, external, totpEnabled }`.
- `POST /api/auth/register` → só se `!hasUser()`, senão **403**. Body
  `{username, email, password}`. Cria usuário (argon2id), emite sessão (set-cookie).
- `POST /api/auth/login` → `{username, password, totp?}`. Aplica throttle + as 4 regras
  do gate. Sucesso → set-cookie de sessão.
- `POST /api/auth/logout` → revoga a sessão atual, limpa o cookie. (Requer sessão.)
- `GET  /api/auth/me` → `{username, email, totpEnabled}`. (Requer sessão.)
- `POST /api/auth/totp/enroll` → gera secret pendente, retorna `{otpauthUri, qrDataUrl}`.
  (Requer sessão + origem local.)
- `POST /api/auth/totp/confirm` → `{token}` valida contra o secret pendente → habilita.
  (Requer sessão + origem local.)
- `POST /api/auth/totp/disable` → `{password}` (+ `token` se enrolado) → desabilita.
  (Requer sessão + origem local.)

### Middleware — `src/http/app.ts`
- Remove o check de bearer estático (`opts.token`).
- Em `/api/*` **exceto** `/api/auth/{status,login,register}`: valida o **cookie de
  sessão** (`validate(id)`); inválido/ausente → **401**.
- **CSRF (defesa em profundidade):** além de `SameSite=Strict`, exigir um header custom
  same-origin (ex. `X-Tormod: 1`) nas mutações; requests cross-site não conseguem setá-lo
  sem preflight CORS (que negamos). Métodos `GET`/`HEAD`/SSE isentos.
- Cookie de sessão: `httpOnly`, `SameSite=Strict`, `Secure` (controlado por
  `TORMOD_COOKIE_SECURE`), `Path=/api`.

### `src/server.ts`
- `TORMOD_TOKEN` deixa de ser obrigatório (removido). Instancia `UserStore`,
  `AuthSessionStore`, lê a config de origem/cookie, injeta no `createApp`.

### Frontend
- **`lib/auth.ts`** — `status()`, `register()`, `login()`, `logout()`, `me()`,
  `enrollTotp()`, `confirmTotp()`, `disableTotp()`. Todas via `fetch` com
  `credentials:'include'`. **Nenhum token em JS** (cookie httpOnly carrega tudo).
  Mutações enviam o header `X-Tormod: 1`.
- **`lib/api.ts`** — remove `Authorization`, `getToken/setToken`, `TOKEN_KEY`. Requests
  same-origin levam o cookie automaticamente; manter `X-Tormod: 1` nas mutações.
  `401` → dispara volta ao login (sinaliza `unauthorized`). SSE via fetch-reader já não
  precisa de header de auth (cookie vai sozinho).
- **`components/auth/AuthGate.tsx`** (substitui `TokenGate` em `App.tsx`):
  - No mount, chama `status()`. `!registered` → `RegisterForm`. `registered` → `LoginForm`.
  - `RegisterForm`: username, email, senha (+ confirmação). Sucesso → autenticado.
  - `LoginForm`: username + senha; campo TOTP visível só quando `external && totpEnabled`;
    se `external && !totpEnabled`, mostra aviso e bloqueia.
- **`components/settings/` (seção 2FA)** — no `SettingsDrawer`: estado do 2FA; botão
  "Configurar 2FA" → `enrollTotp()` → mostra QR (`qrDataUrl`) + campo de confirmação →
  `confirmTotp()`. "Desativar 2FA" → pede senha. (Visível/operável só em origem local.)

## Modelo de dados (SQLite, mesmo arquivo do audit)

```sql
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY CHECK (id = 1),   -- single-user
  username     TEXT NOT NULL UNIQUE,
  email        TEXT NOT NULL,
  pw_hash      TEXT NOT NULL,
  totp_secret  TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id_hash     TEXT PRIMARY KEY,        -- sha256(session_id)
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);
```

## Fluxos

1. **Primeiro setup (local):** load → `status` `{registered:false}` → `RegisterForm` →
   `POST /register` → usuário criado + cookie → dentro.
2. **Retorno (cookie válido):** load → request autenticada passa → dentro (sem tela).
3. **Retorno (sem cookie / expirado), local:** `status` `{registered:true, external:false}`
   → `LoginForm` (só senha) → `POST /login` → cookie → dentro.
4. **Acesso externo, 2FA on:** `status` `{external:true, totpEnabled:true}` → login pede
   senha + código → validados juntos → cookie.
5. **Acesso externo, 2FA off:** `status` `{external:true, totpEnabled:false}` → login
   bloqueado com aviso "configure 2FA pela LAN/VPN".
6. **Enroll 2FA (local):** Settings → `enroll` → escaneia QR → `confirm` → habilitado.
7. **401 em qualquer request:** front volta ao `AuthGate`.

## Segurança — checklist OWASP coberto

- **Broken Auth:** Argon2id, sessão opaca hasheada no DB, rate limit IP+username, lock
  de conta, erro genérico anti-enumeração, registro fecha após 1º usuário.
- **XSS:** nada de token/sessão em JS; cookie `httpOnly`.
- **CSRF:** `SameSite=Strict` + header custom same-origin nas mutações.
- **Brute force:** throttle IP (5/min→15min) + username (5 falhas→10min) + TOTP externo.
- **Transporte:** `Secure` em prod (TLS no proxy de borda — infra/Plano 5).

## Testes (vitest, sqlite `:memory:`)

- `UserStore`: create/hasUser, verifyPassword (ok/errado), single-user constraint,
  setTotpSecret/enable/disable.
- `AuthSessionStore`: issue→validate, expiry, revoke, revokeAll, id cru nunca persistido.
- `origin`: CIDR match, XFF honrado só do proxy confiável, peer direto.
- `throttle`: IP 5/min→bloqueio, username 5 falhas→lock, reset.
- `totp`: verify janela ok/erro.
- Rotas: register-once→403; login local só-senha; login externo exige totp; externo sem
  totp→nega; logout revoga; middleware 401; CSRF sem header→bloqueia mutação.

## Fora de escopo (desta spec)

- Reverse proxy / TLS / HSTS / Authelia na borda (infra, Plano 5 de deploy).
- Reset de senha por email (email é só metadado por ora).
- Múltiplos usuários / RBAC (single-user por design).
- "Lembrar dispositivos" / device trust.

## Pendência operacional após implementar

- No deploy externo: garantir que a app **não** é port-forwardada direto — só via proxy
  confiável — e setar `TORMOD_TRUSTED_PROXY` + `TORMOD_COOKIE_SECURE=true`.
