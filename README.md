# Mist Engine HUD — Legend in the Mist

An always-open, never-in-the-way HUD for the **official Legend in the Mist system**
for Foundry VTT (`mist-engine-fvtt`). Adapted from
[Mist Engine HUD](https://github.com/mordachai/mist-hud) by Gus and Snagov, which
supports the City of Mist system family.

*Português abaixo.*

## What it does

**Hero HUD** (opens when you select your hero's token, or with the book button in the
token controls, or Shift+H):

- Themes with their power and weakness tags, coloured by type (Origin, Adventure,
  Greatness, Variable), story themes and the Fellowship theme card.
- Click a tag to select it; click the scratch icon to mark it **to burn** (+3, one per
  roll), click again to scratch it, once more to restore it.
- Weaknesses (and backpack tags) can be inverted for one roll with the arrows.
- Backpack, rotes, story tags and statuses on the hero. Statuses: click cycles
  helps (+) → hinders (−) → unused; double-click edits; right-click deletes.
- Footer: modifier, Might (when the system setting is on) and a live **Power** preview
  that includes scene, story and challenge tags selected by the Narrator.
- Move buttons: **Quick**, **Detailed**, **Reaction**; the second page has the three
  **Sacrifice** levels. Rolls go through the system's own roll engine and chat cards,
  so burning, Improve marks, scratching fellowship tags, GM roll confirmation and
  Dice So Nice behave exactly as on the sheet. Shift-click a move to open the system's
  roll dialog instead (or make that the default in the settings).
- Side panel: fellowship relationships (select / scratch / add), Promises, active
  special improvements, quintessences.
- Hover a theme's icon: Quest, Improve / Abandon / Milestone tracks (click a box to
  set it) and special improvements.

**Challenge HUD** (Narrator: right-click a Challenge token): roles, difficulty,
description, Limits (struck when reached), tags and statuses (select for the roll,
add, edit, delete), Mighty aspects, special features, threats and consequences,
secrets. Every tag/status mark can be dragged onto a token.

Selection state lives on the system's own documents, so the HUD, the character sheet
and the system roll dialog always agree.

## Install

Foundry setup → Add-on Modules → Install Module → Manifest URL:

```
https://raw.githubusercontent.com/pedronaraujo/mist-hud-litm/main/module.json
```

Requires the Legend in the Mist system (`mist-engine-fvtt`) 14.5 or later.

---

## Português

HUD sempre aberto para o **sistema oficial de Legend in the Mist** no Foundry VTT.
Adaptado do Mist Engine HUD (Gus e Snagov).

- **HUD do Herói**: temas com tags de poder e fraqueza, tema de Sociedade, mochila,
  rotinas, tags de história e status. Clique para selecionar; o ícone de risco marca
  para queimar (+3), risca e restaura. Rodapé com modificador, Poderio e prévia do
  **Poder**. Botões de ação Rápida, Detalhada e Reação, e Sacrifício na segunda página.
  As rolagens usam o motor do próprio sistema. Shift+clique abre o diálogo de rolagem
  do sistema.
- **HUD do Desafio** (Narrador, botão direito no token): limites, tags e status,
  aspectos poderosos, ameaças e consequências, segredos.

Instalação pela URL de manifesto acima.

## License

MIT. Original Mist Engine HUD © Mordachai (Gus) and contributors; UI art from that module.
