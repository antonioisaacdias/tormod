<div align="center">
  <img src="docs/mark.svg" alt="Huginn" width="80">
  <h1>Huginn</h1>
  <p><em>O corvo do pensamento que Odin solta pelos nove mundos — e que volta com notícias.</em></p>
</div>

---

**Huginn** é um servidor **MCP** (Model Context Protocol) que expõe operações de homelab como *tools*. Ele não tem inteligência própria: qualquer cérebro pluga nele — o Claude Code (v1), um PWA pelo celular (fase 2), ou um agente próprio. **O cérebro pensa e decide; o Huginn fornece as mãos e medeia a aprovação.**

O destino de longo prazo não é um MCP de ops, e sim a **superfície única de gestão do homelab**: ops, dashboard, docs, config e consumo num lugar só — crescendo por módulos sobre um chassi extensível.

## Princípios

- **O servidor é o produto; o cérebro é cliente.** Tools consumíveis por qualquer cliente MCP, com qualquer modelo (cloud ou local). Nada de *Claude-ismos* embutidos.
- **Segurança em duas camadas.** Leitura roda livre via allowlist; tudo que altera estado pede aprovação humana com o **comando literal** à vista; destrutivo fica fora do v1.
- **Dono dos próprios dados.** Audit local (SQLite), sem depender de formato privado de cliente, sem guardar API key de LLM.

## Tiers de permissão

| Tier | Cor | Comportamento |
|---|---|---|
| leitura | 🟢 `safe` | roda direto (allowlist) |
| altera estado | 🟡 `approve` | pede aprovação, mostra o comando literal |
| destrutivo | 🔴 `danger` | gated / fora do v1 |

## Configuração

Rede (host, porta, user, chave) vem do `~/.ssh/config`. O inventário só mapeia `node → alias ssh` e define a allowlist:

```bash
cp inventory.example.yaml ~/.config/homelab/huginn/inventory.yaml
# edite com os seus nodes e a allowlist desejada
```

O arquivo real **não é versionado** (ver `.gitignore`). Apenas o `inventory.example.yaml` vive no repo.

## Status

Em especificação. A fonte da verdade do produto é o [`PRODUCT.md`](PRODUCT.md) — o **quê** e o **porquê**; o **como** fica a cargo da implementação.

Design visual: [`docs/palette.html`](docs/palette.html) (paleta *Corvo & Circuito*) · [`docs/mockup.html`](docs/mockup.html) (UI da fase 2).
