// npc-hud.js — Challenge HUD for Legend in the Mist (litm-npc actors).
//
// Shows a Challenge at a glance: roles and difficulty, Limits (with the ones
// already reached), tags and statuses, Mighty aspects, special features,
// threats and consequences. The Narrator can select the challenge's tags and
// statuses for the next roll (as in the system's scene app), add, edit and
// remove them, and drag any tag/status/consequence mark onto a token.

import { MODULE_ID, SETTINGS, L, modulePath, onClicks } from "./constants.js";
import { getChallengeData } from "./data.js";
import * as A from "./actions.js";
import { systemReady } from "./system.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const esc = (s) => foundry.utils.escapeHTML ? foundry.utils.escapeHTML(String(s ?? "")) : Handlebars.escapeExpression(String(s ?? ""));

/** One challenge HUD per token (or per actor when opened without a token). */
export const npcHudRegistry = new Map();

export class NpcHUD extends HandlebarsApplicationMixin(ApplicationV2) {
  actor = null;
  token = null;

  static DEFAULT_OPTIONS = {
    id: "npc-hud",
    classes: ["npc-hud", "mhl-npc-hud"],
    window: { frame: true, positioned: true, resizable: false, minimizable: true, title: "MistHUD.window.npcHud" },
    position: { width: 320, height: "auto", left: 950, top: 110 },
    actions: { openSheet: NpcHUD.#onOpenSheet },
  };

  static PARTS = { app: { template: modulePath("templates/npc-hud.hbs"), scrollable: [".npc-content"] } };

  get title() { return this.actor?.name ?? L("window.npcHud"); }

  static #onOpenSheet(event) {
    event.preventDefault();
    this.actor?.sheet?.render(true);
  }

  async _prepareContext() {
    await systemReady;
    const data = getChallengeData(this.actor);
    return {
      ...data,
      canEdit: this.actor.isOwner,
      showSecrets: game.user.isGM,
      descCollapsed: game.settings.get(MODULE_ID, SETTINGS.NPC_COLLAPSED),
      failIcon: modulePath("ui/icons/litm_fail_icn.svg"),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    this._injectHeader();

    root.querySelector(".accordion-header")?.addEventListener("click", async (ev) => {
      const content = root.querySelector(".accordion-content");
      const open = content.style.display === "none";
      content.style.display = open ? "" : "none";
      ev.currentTarget.classList.toggle("active", open);
      await game.settings.set(MODULE_ID, SETTINGS.NPC_COLLAPSED, !open);
    });

    if (this.actor.isOwner) {
      root.querySelectorAll(".npc-story-tag[data-index]").forEach(el => {
        onClicks(el, (ev) => ev.shiftKey ? A.toggleFloatingPolarity(this.actor, +el.dataset.index) : A.toggleFloatingSelected(this.actor, +el.dataset.index),
          async () => {
            const name = await this._promptText(L("hud.renameTag"), "", el.dataset.name);
            if (name) A.updateFloating(this.actor, +el.dataset.index, { name });
          });
        el.addEventListener("contextmenu", async ev => {
          ev.preventDefault();
          if (await this._confirmDelete(el.dataset.name)) A.deleteFloating(this.actor, +el.dataset.index);
        });
      });
      root.querySelectorAll(".npc-status[data-index]").forEach(el => {
        onClicks(el, () => A.cycleStatus(this.actor, +el.dataset.index), async () => {
          const res = await this._promptStatus({ name: el.dataset.name, tier: +el.dataset.tier, positive: el.dataset.positive === "true" });
          if (res) A.updateFloating(this.actor, +el.dataset.index, res);
        });
        el.addEventListener("contextmenu", async ev => {
          ev.preventDefault();
          if (await this._confirmDelete(`${el.dataset.name}-${el.dataset.tier}`)) A.deleteFloating(this.actor, +el.dataset.index);
        });
      });
      root.querySelector(".create-npc-tag")?.addEventListener("click", async () => {
        const text = await this._promptText(L("hud.createTag"), L("hud.createTagHint"));
        if (text) A.addFloating(this.actor, text);
      });
      root.querySelector(".create-npc-status")?.addEventListener("click", async () => {
        const res = await this._promptStatus({ name: "", tier: 1, positive: true }, true);
        if (res?.name) A.addFloating(this.actor, `${res.name}-${res.tier}`, { forceStatus: true, positive: res.positive });
      });
    }

    // Own tags/statuses: drag with the system's drag format
    root.querySelectorAll("[data-drag-type]").forEach(el => {
      el.setAttribute("draggable", "true");
      el.addEventListener("dragstart", ev => {
        const d = el.dataset;
        const data = { type: d.dragType, name: d.name };
        if (d.dragType === "status") { data.value = d.tier; if (d.positive === "false") data.positive = "false"; }
        ev.dataTransfer.setData("text/plain", JSON.stringify(data));
      });
    });
    // Marks inside threats/consequences/limits (system markup): draggable too
    root.querySelectorAll("mark.draggable").forEach(el => {
      el.addEventListener("dragstart", ev => {
        ev.stopPropagation();
        ev.dataTransfer.setData("text/plain", JSON.stringify({ ...el.dataset }));
      });
    });

    root.addEventListener("contextmenu", ev => ev.preventDefault());
  }

  _injectHeader() {
    const header = this.element.querySelector(".window-header");
    if (!header || header.classList.contains("mh-custom-header")) return;
    header.querySelector(".window-title")?.style.setProperty("display", "none");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "header-control icon fa-solid fa-id-card mh-open-sheet";
    b.dataset.action = "openSheet";
    b.dataset.tooltip = L("hud.openSheet");
    const first = header.querySelector(".header-control");
    first ? header.insertBefore(b, first) : header.append(b);
    const imgWrap = document.createElement("div");
    imgWrap.className = "mh-token-image";
    const img = document.createElement("img");
    img.src = this.token?.document?.texture?.src ?? this.actor.prototypeToken?.texture?.src ?? this.actor.img;
    imgWrap.append(img);
    const name = document.createElement("div");
    name.className = "mh-char-name";
    name.textContent = this.token?.name ?? this.actor.name;
    header.append(imgWrap, name);
    header.classList.add("mh-custom-header");
  }

  async _confirmDelete(name) {
    return DialogV2.confirm({
      window: { title: L("hud.delete") },
      content: `<p>${esc(L("hud.deleteConfirm", { name: name ?? "" }))}</p>`,
      rejectClose: false,
    });
  }

  async _promptText(title, hint = "", value = "") {
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

  async close(options) {
    for (const [k, hud] of npcHudRegistry) if (hud === this) npcHudRegistry.delete(k);
    return super.close(options);
  }
}

/** Open (or bring forward) the challenge HUD of a token or actor. */
export async function openChallengeHud(actor, token = null) {
  if (!actor || actor.type !== "litm-npc") return null;
  const key = token?.id ?? actor.uuid;
  let hud = npcHudRegistry.get(key);
  if (hud?.rendered) { if (hud.minimized) hud.maximize(); hud.bringToFront(); return hud; }
  const slot = npcHudRegistry.size % 8;
  const base = NpcHUD.DEFAULT_OPTIONS.position;
  hud = new NpcHUD({
    id: `npc-hud-${key.replace(/[^A-Za-z0-9_-]/g, "-")}`,
    position: { left: base.left + slot * 28, top: base.top + slot * 28 },
  });
  hud.actor = actor;
  hud.token = token;
  npcHudRegistry.set(key, hud);
  await hud.render({ force: true });
  return hud;
}
