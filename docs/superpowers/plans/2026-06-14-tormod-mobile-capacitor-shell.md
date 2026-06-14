# Tormod Mobile — Capacitor Android Shell (Plano 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empacotar o React de `apps/web` como um APK Android via Capacitor que opera o Tormod sobre a WireGuard, provando antes de tudo que o SSE streama no WebView (`androidScheme: 'http'`).

**Architecture:** O build host é o **node debian** (JDK 21 + KVM já presentes). Toolchain Android (cmdline-tools + emulador) e Node ficam **user-local** (sem sudo, exceto add ao grupo `kvm`). O Capacitor empacota o build Vite (`webDir: dist`); o `android/` nativo é gerado e **commitado no repo**. A validação crítica (Spike 0) prova streaming de SSE num **emulador headless** contra o homolog (`192.168.0.10:8080`) via `adb logcat`. Só depois vem o endurecimento (network-security-config restrito, ícones, keystore de release) e o e2e final no celular real sobre a wg.

**Tech Stack:** Capacitor 8 (`@capacitor/cli`, `@capacitor/android` ^8.4.0), Android SDK cmdline-tools (platform 35 / build-tools 35 / emulador x86_64 google_apis), Gradle wrapper (gerado pelo Capacitor), JDK 21, Node 22 (nvm), Vite 8 + React 19 (existente).

**Build workstation:** debian (`192.168.0.110`, alias SSH `debian`, user `odin`). Todos os comandos Android/Gradle/emulador rodam **via SSH no debian**. Edições de código React/backend são autoradas no checkout do odin e sincronizadas por git; o scaffolding `cap add android` e os builds de APK rodam no checkout do debian.

---

## Contexto herdado (já pronto antes deste plano)

- **Spec:** `docs/superpowers/specs/2026-06-13-tormod-mobile-capacitor-design.md` (fonte da verdade).
- **Plano 1 (backend token) DONE:** `sessionMiddleware` aceita `Authorization: Bearer <session id>`; `login`/`register` retornam `token` quando `X-Tormod-Client: native`; **CORS opt-in** via env `TORMOD_CORS_ORIGINS` (default vazio=off) em `apps/server/src/http/`. Testado em vitest.
- **Plano 2 (front seam) DONE:** `apps/web/src/lib/request.ts` (`buildRequest`/`validateServerUrl`), `lib/platform.ts` (`isNative` via `@capacitor/core`, storage localStorage `serverUrl`+`token`, `apiFetch`), `api.ts`+`auth.ts` roteados por `apiFetch` (SSE incluso), `ServerScreen` + gate native-only em `AppRoot`. Web inalterado.
- **Estado do toolchain (auditado 2026-06-14 via SSH):** debian tem **JDK 21** e **/dev/kvm** (12 flags vmx/svm). FALTAM: Node, Android SDK/adb/sdkmanager/emulator, Android Studio. `odin` NÃO está no grupo `kvm`. Sem DISPLAY no shell SSH (seat físico é do user `debian`). Arch x86_64. Disco `/` 54G livres. Homolog alcançável do debian (`curl http://192.168.0.10:8080/api/auth/status` → 200).

## Restrições de operação (do projeto)

- **Sudo no debian é interativo** (sem NOPASSWD): qualquer passo com `sudo` é executado **pelo usuário no terminal** (prefixo `! ` na sessão), não pelo agente. Este plano isola o sudo a **um único passo** (grupo `kvm`).
- **GUI inviável via SSH:** o emulador roda **headless** (`-no-window`); a inspeção é por `adb logcat` e `adb shell`. Nada de Android Studio GUI.
- **Branch:** trabalho nasce de `develop` numa feature `feat/mobile-capacitor` (já existe, atual). Push vai pros DOIS remotes (`forgejo` + `origin`). NÃO commitar direto em `main`/`develop`.

## File Structure

| Arquivo | Responsabilidade | Onde é gerado/editado |
|---|---|---|
| `apps/web/capacitor.config.ts` | Config Capacitor: `appId`, `appName`, `webDir: 'dist'`, `android.androidScheme: 'http'` | autorado (odin), commitado |
| `apps/web/package.json` | + devDeps `@capacitor/cli`, `@capacitor/android`; + scripts `cap:sync`, `cap:build` | autorado (odin) |
| `apps/web/android/` | Projeto nativo Android gerado pelo Capacitor (Gradle, manifest, MainActivity) | `cap add android` (debian), commitado |
| `apps/web/android/app/src/main/res/xml/network_security_config.xml` | Cleartext permitido **restrito** à subnet wg/LAN, não global | autorado (debian, dentro do android/) |
| `apps/web/android/app/src/main/AndroidManifest.xml` | Referencia o network-security-config; permissão INTERNET | editado (debian) |
| `apps/web/android/app/build.gradle` | `versionCode`/`versionName`, `signingConfigs` release | editado (debian) |
| `apps/web/android/keystore.properties` (gitignored) | Caminho + senhas do keystore de release | criado (debian), NUNCA commitado |
| `apps/web/.gitignore` (ou raiz) | Ignorar `android/app/build`, `android/.gradle`, `keystore.properties`, `*.keystore` | autorado |
| `docs/superpowers/plans/2026-06-14-tormod-mobile-capacitor-shell.md` | Este plano | — |

**Decisão de storage:** mantém **localStorage** (já usado no Plano 2), não `@capacitor/preferences`. localStorage persiste no WebView; Preferences é melhoria futura (YAGNI). A spec cita Preferences mas a implementação do Plano 2 já fechou em localStorage.

**Decisão de versão:** `@capacitor/cli`/`@capacitor/android` em `^8.4.0` pra casar com `@capacitor/core` ^8.4.0 já instalado. Capacitor 8 exige Node ≥20 (instalamos 22) e JDK 21 (presente) — compatível.

---

## Phase 0 — Toolchain no debian (build workstation)

Objetivo: deixar o debian capaz de buildar APK e rodar emulador headless acelerado. Quase tudo user-local (sem sudo); exceção isolada = grupo `kvm`.

### Task 0.1: Node 22 via nvm (user-local, sem sudo)

**Files:** nenhum no repo (ambiente debian).

- [ ] **Step 1: Instalar nvm + Node 22 no debian**

Run (via SSH no odin):
```bash
ssh debian 'export NVM_DIR="$HOME/.nvm"; curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash'
ssh debian 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm install 22 && nvm alias default 22'
```

- [ ] **Step 2: Verificar node/npm**

Run:
```bash
ssh debian 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node -v && npm -v'
```
Expected: `v22.x` e um npm 10/11. Se falhar, conferir que o `nvm.sh` foi sourçado.

> **Nota:** a partir daqui, todo comando que usa `node`/`npm`/`npx` no debian precisa sourçar o nvm primeiro: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh";`. Os passos abaixo já incluem.

### Task 0.2: Android SDK cmdline-tools (user-local, sem sudo)

**Files:** nenhum no repo. Instala em `$HOME/Android/Sdk` (em `/`, 54G livres — SDK+imagem ~12GB).

- [ ] **Step 1: Baixar e posicionar os cmdline-tools**

Run:
```bash
ssh debian 'set -e
  SDK="$HOME/Android/Sdk"; mkdir -p "$SDK/cmdline-tools"
  cd /tmp && curl -fsSL -o cmdtools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  rm -rf "$SDK/cmdline-tools/latest" && unzip -q cmdtools.zip -d "$SDK/cmdline-tools"
  mv "$SDK/cmdline-tools/cmdline-tools" "$SDK/cmdline-tools/latest"
  echo "ok cmdline-tools em $SDK"'
```
Expected: `ok cmdline-tools em /home/odin/Android/Sdk`.

- [ ] **Step 2: Persistir ANDROID_HOME/PATH no `~/.bashrc` do debian**

Run:
```bash
ssh debian 'grep -q ANDROID_HOME ~/.bashrc || cat >> ~/.bashrc <<EOF

export ANDROID_HOME="\$HOME/Android/Sdk"
export PATH="\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools:\$ANDROID_HOME/emulator:\$PATH"
EOF
echo done'
```
Expected: `done`.

- [ ] **Step 3: Aceitar licenças e instalar pacotes (platform 35, build-tools, emulador, system image x86_64)**

Run:
```bash
ssh debian 'set -e; export ANDROID_HOME="$HOME/Android/Sdk"
  export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
  yes | sdkmanager --licenses >/dev/null
  sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" "emulator" "system-images;android-35;google_apis;x86_64"
  echo "--- installed ---"; sdkmanager --list_installed'
```
Expected: lista incluindo `platform-tools`, `platforms;android-35`, `build-tools;35.0.0`, `emulator`, `system-images;android-35;google_apis;x86_64`.

### Task 0.3: Acesso a /dev/kvm (ÚNICO passo com sudo — usuário executa)

**Files:** nenhum.

- [ ] **Step 1: Adicionar `odin` ao grupo `kvm` no debian**

> Sudo no debian é interativo. **O usuário roda no terminal** (prefixo `! `), porque o agente não tem a senha:
```bash
! ssh -t debian 'sudo usermod -aG kvm odin'
```

- [ ] **Step 2: Re-logar a sessão SSH e verificar o grupo + acesso ao device**

> A mudança de grupo só vale em nova sessão. As conexões SSH seguintes do agente já pegam o grupo novo.

Run:
```bash
ssh debian 'id -nG | tr " " "\n" | grep -x kvm && test -r /dev/kvm && test -w /dev/kvm && echo "kvm OK"'
```
Expected: `kvm` e `kvm OK`. Se vazio, a sessão antiga ainda está cacheada — abrir nova conexão SSH.

### Task 0.4: Criar AVD e provar boot headless acelerado

**Files:** nenhum.

- [ ] **Step 1: Criar o AVD x86_64**

Run:
```bash
ssh debian 'export ANDROID_HOME="$HOME/Android/Sdk"
  export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"
  echo no | avdmanager create avd -n tormod_spike -k "system-images;android-35;google_apis;x86_64" -d pixel_6 --force
  avdmanager list avd | grep -A2 tormod_spike'
```
Expected: AVD `tormod_spike` listado.

- [ ] **Step 2: Bootar headless e esperar o `sys.boot_completed`**

Run (background + espera por adb):
```bash
ssh debian 'export ANDROID_HOME="$HOME/Android/Sdk"
  export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"
  nohup emulator -avd tormod_spike -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -accel on >/tmp/emu.log 2>&1 &
  adb wait-for-device
  until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d "\r")" = "1" ]; do sleep 2; done
  echo "BOOTED"; adb devices'
```
Expected: `BOOTED` e um `emulator-5554   device`. Se o emulador cair, conferir `/tmp/emu.log` (provável KVM/grupo — voltar à Task 0.3).

### Task 0.5: Checkout do repo no debian

**Files:** nenhum no repo (clona o repo no debian).

- [ ] **Step 1: Clonar e selecionar a branch**

Run:
```bash
ssh debian 'set -e
  test -d ~/tormod/.git || git clone forgejo:antonioisaacvd/tormod.git ~/tormod
  cd ~/tormod && git fetch --all && git checkout feat/mobile-capacitor && git pull --ff-only
  git log --oneline -1'
```
Expected: HEAD na `feat/mobile-capacitor` (mesmo commit do odin).

- [ ] **Step 2: Instalar deps do web e provar o build**

Run:
```bash
ssh debian 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
  cd ~/tormod/apps/web && npm ci && npm run build && ls -d dist'
```
Expected: build verde, diretório `dist` presente.

---

## Phase 1 — Spike 0: viabilidade do SSE no WebView (GATE)

Objetivo: provar que `fetch`-SSE streama no WebView Android com `androidScheme: 'http'` contra o homolog. **Se não streamar, parar e reavaliar** (plugin SSE nativo) antes de qualquer endurecimento.

### Task 1.1: capacitor.config.ts + devDeps

**Files:**
- Create: `apps/web/capacitor.config.ts`
- Modify: `apps/web/package.json` (devDeps + scripts)
- Modify: raiz `.gitignore` (ou `apps/web/.gitignore`)

- [ ] **Step 1: Criar `apps/web/capacitor.config.ts`** (autorar no odin)

```ts
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'br.com.diaslabs.tormod',
  appName: 'Tormod',
  webDir: 'dist',
  android: {
    androidScheme: 'http',
  },
}

export default config
```

- [ ] **Step 2: Adicionar devDeps + scripts no `apps/web/package.json`** (autorar no odin)

Adicionar em `devDependencies`:
```json
"@capacitor/cli": "^8.4.0",
"@capacitor/android": "^8.4.0"
```
Adicionar em `scripts`:
```json
"cap:sync": "cap sync android",
"cap:apk": "npm run build && cap sync android && cd android && ./gradlew assembleDebug"
```

- [ ] **Step 3: Ignorar artefatos nativos** — adicionar ao `.gitignore` (autorar no odin)

```gitignore
apps/web/android/app/build/
apps/web/android/build/
apps/web/android/.gradle/
apps/web/android/.idea/
apps/web/android/local.properties
apps/web/android/app/release/
apps/web/android/keystore.properties
apps/web/**/*.keystore
apps/web/**/*.jks
```

- [ ] **Step 4: Commit (config + gitignore, sem o android/ ainda)**

```bash
git add apps/web/capacitor.config.ts apps/web/package.json .gitignore
git commit -m "feat(mobile): add capacitor config and android build scripts"
```

### Task 1.2: Gerar o projeto android/ no debian

**Files:**
- Create: `apps/web/android/` (gerado pelo Capacitor)

- [ ] **Step 1: Pull no debian e instalar as novas devDeps**

Run:
```bash
ssh debian 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
  cd ~/tormod && git pull --ff-only && cd apps/web && npm install'
```
Expected: `@capacitor/cli` e `@capacitor/android` instalados.

- [ ] **Step 2: Adicionar a plataforma Android**

Run:
```bash
ssh debian 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
  export ANDROID_HOME="$HOME/Android/Sdk"
  cd ~/tormod/apps/web && npm run build && npx cap add android && ls android/app/src/main'
```
Expected: projeto `android/` criado, com `AndroidManifest.xml` e `assets/public` populado pelo `dist`.

- [ ] **Step 3: Commit do android/ gerado (a partir do debian)**

Run:
```bash
ssh debian 'cd ~/tormod && git add apps/web/android && git -c user.name="Antonio Isaac" -c user.email="antonioisaacvd@gmail.com" commit -m "feat(mobile): scaffold android native project via capacitor" && git push forgejo HEAD && git push origin HEAD'
```
Expected: commit pushado nos dois remotes. (No odin: `git pull` depois pra sincronizar.)

### Task 1.3: Subir homolog com CORS pra origem nativa

**Files:** nenhum no repo (config de runtime do homolog).

- [ ] **Step 1: Habilitar CORS pra `http://localhost` no homolog**

> O backend já suporta `TORMOD_CORS_ORIGINS` (Plano 1, opt-in). O homolog em produção (`:8080`) hoje roda com CORS off. Pro spike, habilitar a origem do WebView.

Run (homolog roda no odin via compose `-p tormod`):
```bash
cd /home/odin/tormod && grep -n TORMOD_CORS_ORIGINS compose.staging.yml || echo "precisa adicionar env"
```
Adicionar/garantir no serviço do `compose.staging.yml`:
```yaml
      TORMOD_CORS_ORIGINS: "http://localhost"
```
- [ ] **Step 2: Redeploy do homolog e verificar o preflight**

Run:
```bash
cd /home/odin/tormod && docker compose -p tormod -f compose.staging.yml up -d
curl -s -i -X OPTIONS http://192.168.0.10:8080/api/auth/status \
  -H 'Origin: http://localhost' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization,x-tormod' | grep -i 'access-control-allow'
```
Expected: headers `Access-Control-Allow-Origin: http://localhost` (e allow-headers incluindo `authorization`). Se vazio, conferir o nome exato do env no código (`apps/server/src/http/`).

### Task 1.4: Buildar, instalar no emulador e PROVAR o SSE (GATE)

**Files:** nenhum (validação).

- [ ] **Step 1: Buildar o APK debug**

Run:
```bash
ssh debian 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; export ANDROID_HOME="$HOME/Android/Sdk"
  cd ~/tormod/apps/web && npm run cap:apk && ls -la android/app/build/outputs/apk/debug/app-debug.apk'
```
Expected: `app-debug.apk` gerado.

- [ ] **Step 2: Instalar no emulador (assumindo bootado da Task 0.4)**

Run:
```bash
ssh debian 'export ANDROID_HOME="$HOME/Android/Sdk"; export PATH="$ANDROID_HOME/platform-tools:$PATH"
  adb install -r ~/tormod/apps/web/android/app/build/outputs/apk/debug/app-debug.apk && echo INSTALLED'
```
Expected: `Success` + `INSTALLED`.

- [ ] **Step 3: Abrir o app, apontar pro homolog e capturar logs do WebView**

Run (inicia logcat em background, lança o app):
```bash
ssh debian 'export ANDROID_HOME="$HOME/Android/Sdk"; export PATH="$ANDROID_HOME/platform-tools:$PATH"
  adb logcat -c
  adb shell monkey -p br.com.diaslabs.tormod -c android.intent.category.LAUNCHER 1
  sleep 4
  adb logcat -d chromium:I "*:S" | tail -40'
```
Expected: o `chromium` (WebView) sobe a SPA. A `ServerScreen` aparece (nativo, sem servidor salvo).

> Como não há GUI, a interação (digitar URL, login) é feita via `adb shell input` OU — mais confiável — por um **probe de SSE direto no WebView** com Chrome DevTools remoto: `chrome://inspect` no debian não está acessível headless, então valida-se o streaming pelo console.log já existente do `apps/web` (o fetch-reader loga eventos) capturado no logcat. Plano B abaixo.

- [ ] **Step 4: GATE — provar streaming incremental de SSE**

Roteiro (via `adb shell input` pra navegar a UI, ou pré-semeando o storage):
1. Pré-semear `serverUrl`+`token` no WebView pra pular a digitação manual headless. Obter um token válido do homolog:
```bash
# registra/loga no homolog em modo nativo, captura o token do corpo
curl -s -X POST http://192.168.0.10:8080/api/auth/login \
  -H 'Content-Type: application/json' -H 'X-Tormod-Client: native' -H 'X-Tormod: 1' \
  -d '{"username":"<user>","password":"<senha>"}' | tee /tmp/login.json
```
2. Injetar `serverUrl`/`token` no localStorage do WebView e recarregar (via `adb shell` + um arquivo JS, ou navegando a `ServerScreen` com `adb shell input text`). Chaves do Plano 2: `tormod:serverUrl` e `tormod:token` (confirmar nomes exatos em `apps/web/src/lib/platform.ts`).
3. Criar uma sessão e enviar uma mensagem; observar o logcat:
```bash
ssh debian 'export ANDROID_HOME="$HOME/Android/Sdk"; export PATH="$ANDROID_HOME/platform-tools:$PATH"
  adb logcat -d chromium:I "*:S" | grep -iE "sse|stream|event|delta|text" | tail -60'
```
Expected (**critério de sucesso do gate**): aparecem **múltiplos eventos SSE chegando incrementalmente** (deltas de `text`/`thinking` ao longo do tempo), não um único blob no fim → o fetch-reader streama no WebView. Capturar evidência (trecho do logcat) no PR.

> **Se o stream NÃO chegar incremental** (ou vier bloqueado por mixed-content/CORS): PARAR. Documentar a falha, reavaliar com plugin SSE nativo (fora do escopo deste plano). O resto das fases depende deste gate.

- [ ] **Step 5: Commit do registro do spike (doc)**

Adicionar uma seção de resultado no fim deste plano (ou um `docs/superpowers/notes/`), com o trecho de logcat que prova o streaming.
```bash
git add docs/superpowers/ && git commit -m "docs(mobile): record SSE-in-WebView spike result"
```

---

## Phase 2 — Fase C: endurecimento, assinatura e e2e real

Só prosseguir se o **gate da Task 1.4 passou**.

### Task 2.1: network-security-config restrito (não cleartext global)

**Files:**
- Create: `apps/web/android/app/src/main/res/xml/network_security_config.xml`
- Modify: `apps/web/android/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: Criar o XML restringindo cleartext à wg/LAN** (editar no debian, dentro do android/)

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- WebView em http://localhost precisa de cleartext local -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">localhost</domain>
        <domain includeSubdomains="false">10.0.0.10</domain>
        <domain includeSubdomains="true">192.168.0.0</domain>
    </domain-config>
    <base-config cleartextTrafficPermitted="false"/>
</network-security-config>
```

> O usuário pode digitar QUALQUER endereço de servidor (cliente desacoplado). `domain` não aceita CIDR. Pro homelab do dono, listar os hosts conhecidos (wg `10.0.0.10`, LAN). Pra um terceiro self-hostando, isto vira ponto de configuração documentado. Alternativa avaliada: cleartext global (`base-config cleartextTrafficPermitted="true"`) — **rejeitado** pela mitigação de risco da spec (não liberar amplo demais). Decisão: lista explícita; documentar no README como editável.

- [ ] **Step 2: Referenciar no `AndroidManifest.xml`** — no `<application ...>` adicionar:

```xml
android:networkSecurityConfig="@xml/network_security_config"
android:usesCleartextTraffic="true"
```
Garantir também a permissão (Capacitor já adiciona, conferir):
```xml
<uses-permission android:name="android.permission.INTERNET" />
```

- [ ] **Step 3: Rebuild + reinstalar + reconfirmar o stream no emulador**

Run:
```bash
ssh debian 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; export ANDROID_HOME="$HOME/Android/Sdk"; export PATH="$ANDROID_HOME/platform-tools:$PATH"
  cd ~/tormod/apps/web && npm run cap:apk && adb install -r android/app/build/outputs/apk/debug/app-debug.apk && echo OK'
```
Expected: `OK`; repetir o roteiro da Task 1.4 (stream ainda funciona com cleartext restrito).

- [ ] **Step 4: Commit**

```bash
ssh debian 'cd ~/tormod && git add apps/web/android/app/src/main/res/xml/network_security_config.xml apps/web/android/app/src/main/AndroidManifest.xml && git -c user.name="Antonio Isaac" -c user.email="antonioisaacvd@gmail.com" commit -m "feat(mobile): restrict cleartext to homelab hosts via network-security-config"'
```

### Task 2.2: Identidade do app (nome, versão, ícone, splash)

**Files:**
- Modify: `apps/web/android/app/build.gradle` (`versionCode`/`versionName`)
- Modify: `apps/web/android/app/src/main/res/values/strings.xml` (`app_name`)
- Create/replace: ícones em `apps/web/android/app/src/main/res/mipmap-*/`

- [ ] **Step 1: Versão** — em `android/app/build.gradle`, no `defaultConfig`:

```gradle
        versionCode 1
        versionName "0.5.0"
```
(Android exige `versionCode` inteiro monotônico; `versionName` = SemVer.)

- [ ] **Step 2: Nome do app** — `strings.xml`:

```xml
<string name="app_name">Tormod</string>
<string name="title_activity_main">Tormod</string>
```

- [ ] **Step 3: Ícone** — gerar via `@capacitor/assets` a partir do logo existente do front (Brand/logo). Se houver `apps/web/public/` com o ícone, usar:

```bash
ssh debian 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
  cd ~/tormod/apps/web && npx @capacitor/assets generate --android --iconBackgroundColor "#0B1220" --iconBackgroundColorDark "#0B1220" 2>&1 | tail -5'
```
Expected: mipmaps gerados. (Se não houver fonte de ícone 1024×1024, criar uma a partir do Brand do front antes — passo de design fora do código.)

- [ ] **Step 4: Rebuild + commit**

```bash
ssh debian 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; export ANDROID_HOME="$HOME/Android/Sdk"
  cd ~/tormod/apps/web && npm run build && npx cap sync android
  cd ~/tormod && git add apps/web/android && git -c user.name="Antonio Isaac" -c user.email="antonioisaacvd@gmail.com" commit -m "feat(mobile): app name, version 0.5.0 and launcher icon"'
```

### Task 2.3: Keystore de release + assinatura

**Files:**
- Create: `apps/web/android/keystore.properties` (gitignored)
- Modify: `apps/web/android/app/build.gradle` (`signingConfigs` + `buildTypes.release`)
- Create (fora do repo): `~/tormod-release.keystore` no debian (gitignored se dentro do repo)

- [ ] **Step 1: Gerar o keystore de release no debian** (keytool vem do JDK 21)

Run:
```bash
ssh debian 'keytool -genkeypair -v -keystore ~/tormod-release.keystore -alias tormod -keyalg RSA -keysize 4096 -validity 10000 -storepass CHANGE_ME -keypass CHANGE_ME -dname "CN=Tormod, O=DIAS LABS, C=BR" && echo KEYSTORE_OK'
```
> Substituir `CHANGE_ME` por senha real (gerar via Vaultwarden [[homelab-vault]]). Guardar a senha no Vault — perder o keystore = não poder atualizar o app instalado.

Expected: `KEYSTORE_OK`.

- [ ] **Step 2: Criar `android/keystore.properties`** (no debian, NÃO commitado — já no .gitignore):

```properties
storeFile=/home/odin/tormod-release.keystore
storePassword=<senha>
keyAlias=tormod
keyPassword=<senha>
```

- [ ] **Step 3: Wire no `android/app/build.gradle`** — antes de `android {` ler o properties, e dentro de `android {` adicionar signingConfig:

```gradle
def keystorePropsFile = rootProject.file("keystore.properties")
def keystoreProps = new Properties()
if (keystorePropsFile.exists()) {
    keystoreProps.load(new FileInputStream(keystorePropsFile))
}

android {
    // ... existente ...
    signingConfigs {
        release {
            if (keystorePropsFile.exists()) {
                storeFile file(keystoreProps['storeFile'])
                storePassword keystoreProps['storePassword']
                keyAlias keystoreProps['keyAlias']
                keyPassword keystoreProps['keyPassword']
            }
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
        }
    }
}
```

- [ ] **Step 4: Buildar o APK release assinado**

Run:
```bash
ssh debian 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; export ANDROID_HOME="$HOME/Android/Sdk"
  cd ~/tormod/apps/web && npm run build && npx cap sync android && cd android && ./gradlew assembleRelease
  ls -la app/build/outputs/apk/release/app-release.apk'
```
Expected: `app-release.apk` assinado.

- [ ] **Step 5: Verificar a assinatura**

Run:
```bash
ssh debian 'export ANDROID_HOME="$HOME/Android/Sdk"
  "$ANDROID_HOME"/build-tools/35.0.0/apksigner verify --print-certs ~/tormod/apps/web/android/app/build/outputs/apk/release/app-release.apk | head'
```
Expected: `Verifies` + cert `CN=Tormod, O=DIAS LABS`.

- [ ] **Step 6: Commit do wiring de assinatura (sem segredos)**

```bash
ssh debian 'cd ~/tormod && git add apps/web/android/app/build.gradle && git -c user.name="Antonio Isaac" -c user.email="antonioisaacvd@gmail.com" commit -m "feat(mobile): release signing config from gitignored keystore.properties"'
```
> Conferir antes: `git status` NÃO mostra `keystore.properties` nem `*.keystore`.

### Task 2.4: Homolog CI — CORS pro mobile permanente

**Files:**
- Modify: `compose.staging.yml`

- [ ] **Step 1: Persistir o `TORMOD_CORS_ORIGINS` no compose de staging** (autorar no odin)

Garantir no serviço:
```yaml
      TORMOD_CORS_ORIGINS: "http://localhost"
```
(A pendência já anotada na memória: "Quando o mobile conectar, setar `TORMOD_CORS_ORIGINS=http://localhost` no `compose.staging.yml`".)

- [ ] **Step 2: Commit (dispara o CI do homolog ao merjar na main, futuro)**

```bash
git add compose.staging.yml && git commit -m "chore(staging): allow native app origin for mobile CORS"
```

### Task 2.5: E2E real no celular sobre a wg (manual, usuário)

**Files:** nenhum (aceitação).

- [ ] **Step 1: Transferir o `app-release.apk` pro celular** (do debian; o celular é peer da wg)

```bash
ssh debian 'ls -la ~/tormod/apps/web/android/app/build/outputs/apk/release/app-release.apk'
```
> Usuário sideloada (adb sobre a wg, ou copia o arquivo). `adb connect <ip-do-celular>:5555` se depuração wireless estiver ligada.

- [ ] **Step 2: Roteiro de aceitação no device real (usuário executa)**

Checklist (na wg):
1. Abrir o app → `ServerScreen` → digitar `http://10.0.0.10:8080` → valida (`/api/auth/status` 200).
2. Cadastrar (1º acesso) ou login (user+senha; 2FA não exigido na wg — origem confiável).
3. Criar uma sessão, enviar "ping" → resposta streamando incremental.
4. Disparar um card de aprovação (ex.: pedir Write) → aprovar → arquivo criado de verdade no odin.
5. Trocar de sessão e voltar → estado preservado.

Expected: todos os passos OK sobre a wg, HTTP dentro do túnel. Documentar resultado.

- [ ] **Step 3: Finalização da branch**

> Usar superpowers:finishing-a-development-branch: merge `feat/mobile-capacitor` → `develop`, push nos dois remotes. (Bump de versão pra `0.5.0` nos `package.json` se ainda não feito.)

---

## Self-Review (do autor do plano)

**Cobertura da spec (`2026-06-13-tormod-mobile-capacitor-design.md`):**
- Faseamento Spike 0 / A / B / C → Phase 1 (Spike 0) + Phase 2 (C). A e B já estavam DONE (Planos 1 e 2) — contexto herdado documentado. ✓
- `androidScheme: 'http'` → Task 1.1. ✓
- CORS pra origem nativa → Task 1.3 (spike) + Task 2.4 (permanente). ✓ (backend já implementado no Plano 1.)
- network-security-config restrito → Task 2.1. ✓
- Casca Capacitor (`capacitor.config.ts`, `android/`) → Tasks 1.1–1.2. ✓
- Ícones/splash/versionName/versionCode → Task 2.2. ✓
- APK assinado (keystore release) → Task 2.3. ✓
- Risco crítico SSE no WebView = gate → Task 1.4 (PARAR se falhar). ✓
- E2E vivo sobre a wg → Task 2.5. ✓
- Distribuição por sideload → Task 2.5 Step 1. ✓
- Token/serverUrl storage → mantém localStorage do Plano 2 (decisão registrada; spec citava Preferences, YAGNI). ✓ (desvio consciente documentado)
- Fora de escopo (push/FCM, multi-server, iOS, TLS) → não tocados. ✓

**Lacunas conscientes:**
- A interação headless com o emulador (digitar URL/login sem GUI) é o ponto mais frágil do spike — mitigado com pré-semeação de `localStorage` + `adb shell input` + observação por `logcat`. Se inviável, fallback = bootar o emulador na sessão de desktop do user `debian` (com GUI) num passo manual.
- `@capacitor/assets` precisa de um ícone-fonte 1024×1024 (Brand do front); se não existir, é um pré-passo de design (Penpot/Excalidraw) fora deste plano.

**Consistência de tipos/nomes:** `appId` `br.com.diaslabs.tormod` usado em config (1.1), launch (1.4), e package de install — consistente. Chaves de storage `tormod:serverUrl`/`tormod:token` marcadas como "confirmar em `platform.ts`" (Plano 2) antes do Step de pré-semeação.

---

## Execução

Pré-requisito do gate: Phase 0 inteira antes da Phase 1; Task 1.4 (gate) antes da Phase 2.

---

## RESULTADO — Spike 0 PASSOU (2026-06-14)

Gate de viabilidade do SSE no WebView **validado no emulador** (debian, headless→janela X11), cérebro **real** (claude-opus-4-8). Prova capturada via fetch-reader rodando dentro do próprio WebView (CDP), contra a instância de spike `odin:8081` (branch atual, CORS on, brain real, DB `/tmp`):

```
t=2211ms  event: usage  (model claude-opus-4-8[1m])
t=4070ms  event: text   {"text":"p"}      ← "pong" fatiado em 2 deltas
t=4112ms  event: text   {"text":"ong"}       em timestamps distintos
t=4192ms  event: result {"ok":true,"costUsd":0.181}
t=5991ms  event: usage  (contextTokens)
t=6811ms  event: usage  (fiveHourPct/sevenDayPct)
t=15004 / 30009ms  event: ping (keepalive — stream longo se mantém)
```
8 tempos de chegada distintos → streaming incremental, não blob único. Depois: `localStorage` semeado (`tormod:serverUrl`+`tormod:token`) → app autenticado, lista a sessão real, badge "Claude Code · 1 vivas". CORS+Bearer+cleartext http→http todos OK no WebView sob `androidScheme:http`.

### Desvios descobertos (corrigir no plano acima ao executar Fase C)

1. **`androidScheme` fica sob `server`, NÃO sob `android`.** A Task 1.1 mostrava `android: { androidScheme }` — ERRADO: Capacitor ignora e serve `https://localhost` (mixed-content bloqueia o backend http). Correto:
   ```ts
   server: { androidScheme: 'http', cleartext: true }
   ```
   `cleartext: true` é necessário pro backend http externo (LAN/wg). Em Fase C, restringir via `network_security_config` (Task 2.1) e reavaliar se `cleartext:true` global pode sair.
2. **JDK do sistema no debian é JRE-only (sem `javac`).** Gradle falha com "Toolchain ... does not provide JAVA_COMPILER". Fix sem sudo: Temurin JDK 21 user-local em `/data/android/jdk` + `~/.gradle/gradle.properties` com `org.gradle.java.home` (config da máquina, NÃO commitada).
3. **Toolchain em `/data`** (disco de experiências do odin, ver [[reference-debian-data-disk]]): `ANDROID_HOME=/data/android/sdk`, `ANDROID_AVD_HOME=/data/android/avd`, JDK em `/data/android/jdk`, checkout em `/data/tormod`. nvm fica no `$HOME` (leve).
4. **debian sem chaves git** → modelo **odin=autoridade git, debian=executor de build**. Sync via `tar` sobre ssh (não há `rsync` no odin). O `android/` gerado volta pro odin pra commitar.
5. **Emulador** roda como serviço `systemd-run --user` (sobrevive entre sessões via `loginctl enable-linger odin`). Janela ao vivo: `xhost +SI:localuser:odin` no desktop do debian + `DISPLAY=:0`, `-gpu swiftshader_indirect`.
6. **Driving headless do app:** `adb shell input` é sabotado pelos diálogos de stylus/handwriting do Android 15. Usar **CDP** (`cdp.mjs`, Node 22 nativo WebSocket+fetch) pra semear `localStorage`/observar SSE.
7. **Spike server descartável** em `odin:8081` (reachable do debian, sem bloqueio de firewall) + usuário `spike`/`spikepass123` — limpar depois. O homolog (`:8080`, `main`) NÃO tem CORS (Plano 1 mobile não está na `main`).
