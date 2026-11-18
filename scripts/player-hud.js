// player-hud.js — The hero HUD for Legend in the Mist (litm-character actors).
//
// Always-open window: select tags and statuses with a click, mark a tag to burn,
// then press a move button. The roll itself is made by the system.

import { MODULE_ID, SETTINGS, L, modulePath, onClicks } from "./constants.js";
import { getHeroData } from "./data.js";
import * as A from "./actions.js";
import { previewPower, rollAction, rollSacrifice, ROLL_TYPES, SACRIFICE_LEVELS } from "./roll.js";
import { sys, systemReady } from "./system.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { DialogV2 } = foundry.applications.api;

/** One HUD per actor (uuid), and the per-roll state that must survive re-renders. */
export const heroHudRegistry = new Map();
const rollState = new Map();

export function getRollState(actor) {
  const key = actor.uuid;
  if (!rollState.has(key)) rollState.set(key, { inverted: new Set(), modifier: 0, might: 0 });
  return rollState.get(key);
}

const MOVE_IMAGES = {
  quick: "ui/Quick Way.webp",
  detailed: "ui/Detailed Way - Attack.webp",
  reaction: "ui/Reaction.webp",
  painful: "ui/sacrifice-painful.webp",
  scarring: "ui/sacrifice-scarring.webp",
  grave: "ui/sacrifice-grave.webp",
};

const esc = (s) => foundry.utils.escapeHTML ? foundry.utils.escapeHTML(String(s ?? "")) : Handlebars.escapeExpression(String(s ?? ""));

export class PlayerHUD extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @type {Actor} */
  actor = null;
  _panelOpen = false;
  _movePage = 0;
  _rolling = false;
  _tooltip = null;
  _tooltipTimer = null;

  constructor(actor, options = {}) {
    const pos = game.settings.get(MODULE_ID, SETTINGS.HUD_POSITION) ?? {};
    super(foundry.utils.mergeObject({ position: { left: pos.left ?? 120, top: pos.top ?? 90 } }, options));
    this.actor = actor;
    heroHudRegistry.set(actor.uuid, this);
  }

  static DEFAULT_OPTIONS = {
    id: "mist-hud",
    classes: ["player-hud", "mist-hud", "mh-hud", "mhl-hud"],
    window: { frame: true, title: "MistHUD.window.playerHud", positioned: true, resizable: false, minimizable: true },
    position: { width: "auto", height: "auto" },
    actions: {
      openSheet: PlayerHUD.#onOpenSheet,
      toggleWide: PlayerHUD.#onToggleWide,
    },
  };

  static PARTS = {
    app: { template: modulePath("templates/player-hud.hbs"), scrollable: [".mh-content-container", ".mh-panel-content"] },
  };

  get title() { return this.actor?.name ?? L("window.playerHud"); }

  static async #onOpenSheet(event) {
    event.preventDefault();
    this.actor?.sheet?.render(true);
  }

  static async #onToggleWide(event) {
    event.preventDefault();
    const wide = !game.settings.get(MODULE_ID, SETTINGS.WIDE_LAYOUT);
    await game.settings.set(MODULE_ID, SETTINGS.WIDE_LAYOUT, wide);
    this._applyWide();
    this.setPosition();
  }

  // ── Context ──────────────────────────────────────────────────────────────

  async _prepareContext(_options) {
    await systemReady;
    if (!this.actor) return {};
    const state = getRollState(this.actor);
    const data = getHeroData(this.actor, state.inverted);
    const useText = game.settings.get(MODULE_ID, SETTINGS.USE_TEXT_BUTTONS);
    const btn = (key, label) => ({ key, label, img: modulePath(MOVE_IMAGES[key]), useText });
    const mightEnabled = !!game.settings.get("mist-engine-fvtt", "mightUsageEnabled");
    const loc = (k) => game.i18n.localize(k);

    return {
      ...data,
      actorId: this.actor.id,
      isOwner: this.actor.isOwner,
      rollButtons: ROLL_TYPES.map(t => btn(t, loc(`MIST_ENGINE.ROLL_TYPES.${t}`))),
      sacrificeButtons: SACRIFICE_LEVELS.map(l => btn(l, `${L("hud.sacrifice")}: ${loc(`MIST_ENGINE.SACRIFICE.Levels.${l}`)}`)),
      movePage: this._movePage,
      modifier: state.modifier,
      mightEnabled,
      mightOptions: [-6, -3, 0, 3, 6].map(v => ({ value: v, label: v > 0 ? `+${v}` : `${v}`, checked: v === state.might })),
      panelOpen: this._panelOpen,
      promiseBoxes: Array.from({ length: 5 }, (_, i) => i < data.promises),
      hasPanelContent: true,
      rollModeDialog: game.settings.get(MODULE_ID, SETTINGS.ROLL_MODE) === "dialog",
    };
  }

  // ── Render ───────────────────────────────────────────────────────────────

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    this._injectHeader();
    this._applyWide();
    this._bindTags(root);
    this._bindStatuses(root);
    this._bindRollBar(root);
    this._bindFooter(root);
    this._bindPanel(root);
    this._bindTooltips(root);
    this._bindDrag(root);
    this.updatePower();
    root.addEventListener("contextmenu", ev => ev.preventDefault());
  }

  _injectHeader() {
    const header = this.element.querySelector(".window-header");
    if (!header || header.classList.contains("mh-custom-header")) return;
    header.querySelector(".window-title")?.style.setProperty("display", "none");
    const mk = (cls, action, label) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `header-control icon fa-solid ${cls}`;
      b.dataset.action = action;
      b.dataset.tooltip = label;
      b.setAttribute("aria-label", label);
      return b;
    };
    const first = header.querySelector(".header-control");
    const buttons = [mk("fa-id-card mh-open-sheet", "openSheet", L("hud.openSheet")),
                     mk("fa-table-columns mh-wide-toggle", "toggleWide", L("hud.wideLayout"))];
    for (const b of buttons) first ? header.insertBefore(b, first) : header.append(b);

    const imgWrap = document.createElement("div");
    imgWrap.className = "mh-token-image";
    const img = document.createElement("img");
    img.src = this.actor.prototypeToken?.texture?.src || this.actor.img;
    img.alt = this.actor.name;
    imgWrap.append(img);
    const name = document.createElement("div");
    name.className = "mh-char-name";
    name.textContent = this.actor.name;
    header.append(imgWrap, name);
    header.classList.add("mh-custom-header");
  }

  _applyWide() {
    const wide = game.settings.get(MODULE_ID, SETTINGS.WIDE_LAYOUT);
    this.element.classList.toggle("mh-wide", wide);
    this.element.querySelector(".mh-wide-toggle")?.classList.toggle("active", wide);
  }

  // ── Tags ─────────────────────────────────────────────────────────────────

  _bindTags(root) {
    const actor = this.actor;
    const state = getRollState(actor);
    const on = (sel, type, fn) => root.querySelectorAll(sel).forEach(el => el.addEventListener(type, ev => {
      ev.preventDefault(); ev.stopPropagation(); fn(el, ev);
    }));

    // Theme power / weakness tags
    on(".mh-power-tag[data-source], .mh-weakness-tag[data-source]", "click", (el, ev) => {
      if (ev.target.closest(".mh-burn-toggle, .mh-weakness-toggle")) return;
      const { source, docId, kind, index } = el.dataset;
      A.toggleThemeTag(actor, source, docId, kind, +index);
    });
    on(".mh-power-tag[data-source] .mh-burn-toggle", "click", (el) => {
      const li = el.closest(".mh-power-tag");
      A.cycleThemeTagBurn(actor, li.dataset.source, li.dataset.docId, +li.dataset.index);
    });

    // Per-roll inversion: a Weakness that helps, a story tag that hinders
    on(".mh-weakness-toggle[data-key], .mh-invert-toggle[data-key]", "click", (el) => {
      const key = el.dataset.key;
      if (state.inverted.has(key)) state.inverted.delete(key); else state.inverted.add(key);
      this.render();
    });

    // Backpack
    root.querySelectorAll(".mh-loadout-tag[data-backpack]").forEach(el => onClicks(el,
      () => A.toggleBackpackTag(actor, el.dataset.backpack, +el.dataset.index),
      async () => {
        const cur = el.querySelector(".mh-tag-text")?.textContent.trim();
        const name = await this._promptText(L("hud.renameTag"), cur);
        if (name) A.renameBackpackTag(actor, el.dataset.backpack, +el.dataset.index, name);
      }));
    on(".mh-loadout-tag[data-backpack] .mh-burn-toggle", "click", (el) => {
      const li = el.closest(".mh-loadout-tag");
      A.cycleBackpackBurn(actor, li.dataset.backpack, +li.dataset.index);
    });
    on(".mh-loadout-tag[data-backpack]", "contextmenu", async (el) => {
      const name = el.querySelector(".mh-tag-text")?.textContent.trim();
      if (await this._confirmDelete(name)) A.deleteBackpackTag(actor, el.dataset.backpack, +el.dataset.index);
    });
    on(".mh-create-backpack-tag", "click", async (el) => {
      const name = await this._promptText(L("hud.newBackpackTag"));
      if (name) A.addBackpackTag(actor, el.dataset.backpack, name);
    });

    // Rotes
    root.querySelectorAll(".mh-rote[data-item-id]").forEach(el => onClicks(el,
      () => A.toggleRote(actor, el.dataset.itemId),
      () => actor.items.get(el.dataset.itemId)?.sheet?.render(true)));

    // Floating story tags on the hero
    root.querySelectorAll(".mh-story-tag[data-floating]").forEach(el => onClicks(el,
      () => A.toggleFloatingSelected(actor, +el.dataset.index),
      async () => {
        const cur = el.querySelector(".mh-tag-text")?.textContent.trim();
        const name = await this._promptText(L("hud.renameTag"), cur);
        if (name) A.updateFloating(actor, +el.dataset.index, { name });
      }));
    on(".mh-story-tag[data-floating] .mh-story-toggle", "click", (el) => {
      A.toggleFloatingPolarity(actor, +el.closest(".mh-story-tag").dataset.index);
    });
    on(".mh-story-tag[data-floating]", "contextmenu", async (el) => {
      const name = el.querySelector(".mh-tag-text")?.textContent.trim();
      if (await this._confirmDelete(name)) A.deleteFloating(actor, +el.dataset.index);
    });
    on(".mh-create-story-tag", "click", async () => {
      const text = await this._promptText(L("hud.createTag"), "", L("hud.createTagHint"));
      if (text) A.addFloating(actor, text);
    });

    // Fellowship relationships
    on(".mh-relationship-tag[data-index]", "click", (el, ev) => {
      if (ev.target.closest(".mh-burn-toggle")) return;
      A.toggleRelationship(actor, +el.dataset.index);
    });
    on(".mh-relationship-tag[data-index] .mh-burn-toggle", "click", (el) => {
      A.toggleRelationshipScratch(actor, +el.closest(".mh-relationship-tag").dataset.index);
    });
    on(".mh-create-relationship", "click", async () => {
      const res = await this._promptRelationship();
      if (res) A.addRelationship(actor, res.companion, res.tag);
    });
    on(".mh-promise", "click", (el) => {
      const i = +el.dataset.index;
      A.setPromises(actor, actor.system.promises === i + 1 ? i : i + 1);
    });
  }

  // ── Statuses ─────────────────────────────────────────────────────────────

  _bindStatuses(root) {
    const actor = this.actor;
    root.querySelectorAll(".mh-status[data-index]").forEach(el => {
      onClicks(el, () => A.cycleStatus(actor, +el.dataset.index), async () => {
        const res = await this._promptStatus({ name: el.dataset.name, tier: +el.dataset.tier, positive: el.dataset.positive === "true" });
        if (res) A.updateFloating(actor, +el.dataset.index, res);
      });
      el.addEventListener("contextmenu", async ev => {
        ev.preventDefault();
        if (await this._confirmDelete(`${el.dataset.name}-${el.dataset.tier}`)) A.deleteFloating(actor, +el.dataset.index);
      });
    });
    root.querySelector(".mh-create-status")?.addEventListener("click", async ev => {
      ev.preventDefault(); ev.stopPropagation();
      const res = await this._promptStatus({ name: "", tier: 1, positive: true }, true);
      if (res?.name) A.addFloating(actor, `${res.name}-${res.tier}`, { forceStatus: true, positive: res.positive });
    });
  }

  // ── Moves ────────────────────────────────────────────────────────────────

  _bindRollBar(root) {
    root.querySelectorAll(".mh-roll-button[data-roll]").forEach(b => b.addEventListener("click", ev => {
      ev.preventDefault();
      this._roll(b.dataset.roll, ev);
    }));
    root.querySelectorAll(".mh-roll-button[data-sacrifice]").forEach(b => b.addEventListener("click", ev => {
      ev.preventDefault();
      this._sacrifice(b.dataset.sacrifice);
    }));
    root.querySelector(".mh-roll-toggle")?.addEventListener("click", ev => {
      ev.preventDefault();
      this._movePage = this._movePage ? 0 : 1;
      root.querySelectorAll(".mh-roll-container[data-page]").forEach(c =>
        c.style.display = (+c.dataset.page === this._movePage) ? "" : "none");
      const i = root.querySelector(".mh-roll-toggle i");
      i?.classList.toggle("fa-caret-up", this._movePage === 0);
      i?.classList.toggle("fa-caret-down", this._movePage === 1);
    });
  }

  async _roll(type, ev) {
    if (this._rolling) return;
    const state = getRollState(this.actor);
    let mode = game.settings.get(MODULE_ID, SETTINGS.ROLL_MODE);
    // Shift-click flips the mode for this roll
    if (ev?.shiftKey) mode = mode === "dialog" ? "direct" : "dialog";
    this._rolling = true;
    try {
      const ok = await rollAction(this.actor, type, {
        inverted: state.inverted, modifier: state.modifier, might: state.might, mode,
      });
      // direct: the roll is made; dialog: the system dialog now holds the
      // inversions and modifier. Either way the HUD's per-roll state is spent.
      if (ok) this._resetRollState();
    } catch (e) {
      console.error("Mist HUD (LitM) | roll failed", e);
      ui.notifications.error(L("notify.rollFailed", { error: e?.message ?? e }));
    } finally {
      this._rolling = false;
    }
  }

  async _sacrifice(level) {
    if (this._rolling) return;
    const state = getRollState(this.actor);
    const label = game.i18n.localize(`MIST_ENGINE.SACRIFICE.Levels.${level}`);
    const ok = await DialogV2.confirm({
      window: { title: game.i18n.localize("MIST_ENGINE.SACRIFICE.Title"), icon: "fa-solid fa-heart-crack" },
      content: `<p>${esc(L("hud.sacrificeConfirm", { level: label, modifier: state.modifier >= 0 ? `+${state.modifier}` : state.modifier }))}</p>`,
      rejectClose: false,
    });
    if (!ok) return;
    this._rolling = true;
    try {
      await rollSacrifice(this.actor, level, { modifier: state.modifier });
      state.modifier = 0;
      this.render();
    } finally { this._rolling = false; }
  }

  /** After a roll the system has cleared the selection; drop the HUD's own per-roll state too. */
  _resetRollState() {
    const state = getRollState(this.actor);
    state.inverted.clear();
    state.modifier = 0;
    state.might = 0;
    this.render();
  }

  // ── Footer: modifier, Might, Power preview ───────────────────────────────

  _bindFooter(root) {
    const state = getRollState(this.actor);
    const input = root.querySelector("#mh-mod-value");
    const set = (v) => { state.modifier = v; if (input) input.value = v; this.updatePower(); };
    root.querySelector("#mh-mod-decrease")?.addEventListener("click", () => set(state.modifier - 1));
    root.querySelector("#mh-mod-increase")?.addEventListener("click", () => set(state.modifier + 1));
    input?.addEventListener("change", () => set(parseInt(input.value) || 0));
    const might = root.querySelector(".mhl-might-select");
    might?.addEventListener("change", () => { state.might = parseInt(might.value) || 0; this.updatePower(); });
  }

  /** Refresh the Power preview without a full re-render. */
  updatePower() {
    const el = this.element?.querySelector(".mh-power-indicator");
    if (!el || !this.actor) return;
    const state = getRollState(this.actor);
    const p = previewPower(this.actor, state);
    if (!p) { el.textContent = ""; return; }
    el.textContent = L("hud.power", { power: p.power });
    el.dataset.tooltip = L("hud.powerTooltip", { positive: p.positive, negative: p.negative, modifier: state.modifier + state.might });
    el.classList.toggle("mhl-power-low", p.raw < 0);
  }

  // ── Side panel ───────────────────────────────────────────────────────────

  _bindPanel(root) {
    const panel = root.querySelector(".mh-sliding-panel");
    root.querySelector(".mh-panel-ear")?.addEventListener("click", () => {
      this._panelOpen = panel.classList.toggle("open");
    });
  }

  // ── Theme tooltip (quest, development tracks, special improvements) ─────

  _bindTooltips(root) {
    root.querySelectorAll(".mh-theme-icon[data-theme-id]").forEach(icon => {
      icon.addEventListener("mouseenter", () => this._showTooltip(icon));
      icon.addEventListener("mouseleave", () => this._scheduleHide());
      icon.addEventListener("click", () => this._showTooltip(icon));
    });
  }

  async _showTooltip(icon) {
    clearTimeout(this._tooltipTimer);
    const { themeId, source } = icon.dataset;
    const data = getHeroData(this.actor, getRollState(this.actor).inverted);
    const theme = source === "fellowship-themecard" ? data.fellowshipTheme : data.themes.find(t => t.id === themeId);
    if (!theme) return;
    const html = await foundry.applications.handlebars.renderTemplate(modulePath("templates/theme-tooltip.hbs"), {
      ...theme, questHtml: theme.quest,
    });
    this._removeTooltip();
    const tip = document.createElement("div");
    tip.className = "mh-tooltip mhl-tooltip";
    tip.innerHTML = html;
    document.body.append(tip);
    const r = icon.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    let left = r.right + 8;
    if (left + tr.width > window.innerWidth - 8) left = r.left - tr.width - 8;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, Math.min(r.top - 10, window.innerHeight - tr.height - 8))}px`;
    tip.addEventListener("mouseenter", () => clearTimeout(this._tooltipTimer));
    tip.addEventListener("mouseleave", () => this._scheduleHide());
    tip.querySelectorAll(".mh-box[data-track]").forEach(box => box.addEventListener("click", async ev => {
      ev.preventDefault();
      await A.setTrack(this.actor, source, themeId, box.dataset.track, +box.dataset.index);
      this._showTooltip(icon);
    }));
    this._tooltip = tip;
  }

  _scheduleHide() {
    clearTimeout(this._tooltipTimer);
    this._tooltipTimer = setTimeout(() => this._removeTooltip(), 300);
  }

  _removeTooltip() {
    this._tooltip?.remove();
    this._tooltip = null;
  }

  // ── Drag: tags and statuses can be dropped on tokens, sheets, the scene app ─

  _bindDrag(root) {
    root.querySelectorAll("[data-drag-type]").forEach(el => {
      el.setAttribute("draggable", "true");
      el.addEventListener("dragstart", ev => {
        const d = el.dataset;
        const data = { type: d.dragType, name: d.name };
        if (d.dragType === "status") { data.value = d.tier; if (d.positive === "false") data.positive = "false"; }
        ev.dataTransfer.setData("text/plain", JSON.stringify(data));
      });
    });
  }

  // ── Small dialogs ────────────────────────────────────────────────────────

  async _confirmDelete(name) {
    return DialogV2.confirm({
      window: { title: L("hud.delete") },
      content: `<p>${esc(L("hud.deleteConfirm", { name: name ?? "" }))}</p>`,
      rejectClose: false,
    });
  }

  async _promptText(title, value = "", hint = "") {
    try {
      const res = await DialogV2.prompt({
        window: { title },
        content: `${hint ? `<p class="hint">${esc(hint)}</p>` : ""}<input type="text" name="text" value="${esc(value)}" autofocus>`,
        ok: { label: L("hud.ok"), callback: (_e, button) => button.form.elements.text.value },
        rejectClose: false,
      });
      return res?.trim() || null;
    } catch { return null; }
  }

  async _promptStatus({ name, tier, positive }, isNew = false) {
    const tiers = [1, 2, 3, 4, 5, 6].map(t => `<option value="${t}" ${t === tier ? "selected" : ""}>${t}</option>`).join("");
    try {
      return await DialogV2.prompt({
        window: { title: isNew ? L("hud.createStatus") : L("hud.editStatus") },
        content: `
          <div class="form-group"><label>${esc(L("hud.statusName"))}</label><input type="text" name="name" value="${esc(name)}" autofocus></div>
          <div class="form-group"><label>${esc(L("hud.statusTier"))}</label><select name="tier">${tiers}</select></div>
          <div class="form-group"><label>${esc(L("hud.statusHelps"))}</label><input type="checkbox" name="positive" ${positive ? "checked" : ""}></div>`,
        ok: {
          label: L("hud.ok"),
          callback: (_e, button) => {
            const f = button.form.elements;
            return { name: f.name.value.trim(), tier: parseInt(f.tier.value) || 1, positive: f.positive.checked };
          },
        },
        rejectClose: false,
      });
    } catch { return null; }
  }

  async _promptRelationship() {
    const others = game.actors.filter(a => a.type === "litm-character" && a.id !== this.actor.id && a.hasPlayerOwner);
    const opts = others.map(a => `<option value="${esc(a.name)}">`).join("");
    try {
      return await DialogV2.prompt({
        window: { title: L("hud.createRelationship") },
        content: `
          <div class="form-group"><label>${esc(L("hud.companion"))}</label><input type="text" name="companion" list="mhl-companions" autofocus><datalist id="mhl-companions">${opts}</datalist></div>
          <div class="form-group"><label>${esc(L("hud.relationshipTag"))}</label><input type="text" name="tag"></div>`,
        ok: {
          label: L("hud.ok"),
          callback: (_e, button) => ({ companion: button.form.elements.companion.value.trim(), tag: button.form.elements.tag.value.trim() }),
        },
        rejectClose: false,
      });
    } catch { return null; }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  _onPosition(position) {
    super._onPosition?.(position);
    clearTimeout(this._posTimer);
    this._posTimer = setTimeout(() => {
      if (game.user) game.settings.set(MODULE_ID, SETTINGS.HUD_POSITION, { left: position.left, top: position.top });
    }, 500);
  }

  async close(options) {
    this._removeTooltip();
    heroHudRegistry.delete(this.actor?.uuid);
    return super.close(options);
  }
}

/** Open (or bring forward) the HUD of a hero. Only one hero HUD is open at a time. */
export async function openHeroHud(actor) {
  if (!actor || actor.type !== "litm-character") return null;
  for (const [key, hud] of heroHudRegistry) if (key !== actor.uuid) await hud.close();
  let hud = heroHudRegistry.get(actor.uuid);
  if (!hud) hud = new PlayerHUD(actor);
  if (hud.rendered) { if (hud.minimized) hud.maximize(); hud.bringToFront(); }
  else await hud.render({ force: true });
  return hud;
}

export function closeHeroHuds() {
  for (const hud of heroHudRegistry.values()) hud.close();
}
