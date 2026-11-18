// init.js — Entry point: settings, templates, hooks, scene controls, drops.
//
// Written so it also works when loaded after "ready" (test copies loaded by
// hand): every setup step runs immediately if its hook has already fired.

import { MODULE_ID, SYSTEM_ID, SETTINGS, L, modulePath, isHero, isChallenge } from "./constants.js";
import { heroHudRegistry, openHeroHud, closeHeroHuds } from "./player-hud.js";
import { npcHudRegistry, openChallengeHud } from "./npc-hud.js";
import { registerSocket, addFloating, relayToGM } from "./actions.js";
import { fellowshipThemecard } from "./data.js";

const active = () => game.system?.id === SYSTEM_ID;

// ── init ─────────────────────────────────────────────────────────────────────

function onInit() {
  const K = (k) => `MistHUD.settings.${k}`;
  const reg = (key, data) => { if (!game.settings.settings.has(`${MODULE_ID}.${key}`)) game.settings.register(MODULE_ID, key, data); };

  reg(SETTINGS.ROLL_MODE, {
    name: K("rollMode.name"), hint: K("rollMode.hint"),
    scope: "client", config: true, type: String, default: "direct",
    choices: { direct: K("rollMode.direct"), dialog: K("rollMode.dialog") },
  });
  reg(SETTINGS.AUTO_OPEN, {
    name: K("autoOpen.name"), hint: K("autoOpen.hint"),
    scope: "client", config: true, type: Boolean, default: true,
  });
  reg(SETTINGS.NPC_HUD_ON_TOKEN, {
    name: K("npcHudOnTokenHud.name"), hint: K("npcHudOnTokenHud.hint"),
    scope: "client", config: true, type: Boolean, default: true,
  });
  reg(SETTINGS.USE_TEXT_BUTTONS, {
    name: K("useTextButtons.name"), hint: K("useTextButtons.hint"),
    scope: "client", config: true, type: Boolean, default: false,
    onChange: () => rerenderAll(),
  });
  reg(SETTINGS.WIDE_LAYOUT, { scope: "client", config: false, type: Boolean, default: false });
  reg(SETTINGS.NPC_COLLAPSED, { scope: "client", config: false, type: Boolean, default: false });
  reg(SETTINGS.HUD_POSITION, { scope: "client", config: false, type: Object, default: {} });

  Handlebars.registerHelper("times", function (n, block) {
    let out = "";
    for (let i = 0; i < (Number(n) || 0); i++) out += block.fn(i);
    return out;
  });

  foundry.applications.handlebars.loadTemplates({
    mhlTheme: modulePath("templates/theme.hbs"),
  });
  foundry.applications.handlebars.loadTemplates([
    modulePath("templates/player-hud.hbs"),
    modulePath("templates/npc-hud.hbs"),
    modulePath("templates/theme-tooltip.hbs"),
  ]);

  try {
    game.keybindings.register(MODULE_ID, "toggleHud", {
      name: K("keyToggle.name"), hint: K("keyToggle.hint"),
      editable: [{ key: "KeyH", modifiers: ["Shift"] }],
      onDown: () => { toggleOwnHud(); return true; },
    });
  } catch (e) { /* loaded after init (test copy): no keybinding */ }
}

// ── ready ────────────────────────────────────────────────────────────────────

let loadGuard = true;

function onReady() {
  registerSocket();
  setTimeout(() => { loadGuard = false; }, 1500);
  globalThis.MistHudLitm = { openHeroHud, openChallengeHud, toggleOwnHud };
}

/** Player: their own hero. GM: the controlled token's hero (or challenge). */
export function toggleOwnHud() {
  const open = [...heroHudRegistry.values()].find(h => h.rendered);
  if (open) return open.close();
  const token = canvas?.tokens?.controlled?.[0];
  if (token?.actor && isHero(token.actor) && token.actor.isOwner) return openHeroHud(token.actor);
  if (token?.actor && isChallenge(token.actor)) return openChallengeHud(token.actor, token);
  const own = game.user.character ?? game.actors.find(a => isHero(a) && a.isOwner && !game.user.isGM);
  if (own) return openHeroHud(own);
  ui.notifications.info(L("notify.noHero"));
}

function rerenderAll() {
  for (const hud of heroHudRegistry.values()) if (hud.rendered) hud.render();
  for (const hud of npcHudRegistry.values()) if (hud.rendered) hud.render();
}

function refreshPower() {
  for (const hud of heroHudRegistry.values()) if (hud.rendered) hud.updatePower();
}

// ── Hooks ────────────────────────────────────────────────────────────────────

function registerHooks() {
  Hooks.on("controlToken", (token, controlled) => {
    if (loadGuard || !game.settings.get(MODULE_ID, SETTINGS.AUTO_OPEN)) return;
    const actor = token.actor;
    if (controlled && isHero(actor) && actor.isOwner && canvas.tokens.controlled.length === 1) {
      openHeroHud(actor);
    } else if (!controlled && canvas.tokens.controlled.length === 0) {
      // keep the HUD of a player's own character open; close the others
      for (const hud of heroHudRegistry.values()) {
        if (hud.actor === actor && (game.user.isGM || game.user.character?.id !== actor?.id)) hud.close();
      }
    }
  });

  // GM: right-click a challenge token (token HUD) to open its challenge HUD
  Hooks.on("renderTokenHUD", (app) => {
    if (!game.user.isGM || !game.settings.get(MODULE_ID, SETTINGS.NPC_HUD_ON_TOKEN)) return;
    const token = app.object;
    if (isChallenge(token?.actor)) openChallengeHud(token.actor, token);
  });

  const forActor = (actor) => {
    if (!actor) return;
    for (const hud of heroHudRegistry.values()) {
      if (!hud.rendered) continue;
      if (hud.actor === actor || hud.actor?.id === actor.id || fellowshipThemecard(hud.actor)?.id === actor.id) hud.render();
    }
    for (const hud of npcHudRegistry.values()) {
      if (hud.rendered && (hud.actor === actor || hud.actor?.id === actor.id)) hud.render();
    }
    // challenge selections feed the heroes' Power preview
    if (isChallenge(actor)) refreshPower();
  };
  Hooks.on("updateActor", forActor);
  for (const h of ["createItem", "updateItem", "deleteItem"]) {
    Hooks.on(h, (item) => {
      if (item.parent) forActor(item.parent);
      else if (item.type === "scene-data") refreshPower(); // scene/story tags selected in the scene app
    });
  }
  Hooks.on("deleteActor", (actor) => {
    for (const hud of [...heroHudRegistry.values(), ...npcHudRegistry.values()]) if (hud.actor?.id === actor.id) hud.close();
  });
  // the system's scene app was re-rendered (selection changed)
  Hooks.on("renderMistSceneApp", refreshPower);

  // Scene controls: open the HUD
  Hooks.on("getSceneControlButtons", (controls) => {
    const tokens = controls.tokens ?? controls.token;
    if (!tokens?.tools) return;
    tokens.tools.mistHudLitm = {
      name: "mistHudLitm",
      title: "MistHUD.controls.toggleHud",
      icon: "fa-solid fa-book-open-reader",
      button: true,
      visible: true,
      order: 50,
      onChange: () => toggleOwnHud(),
    };
  });

  // Drop a tag / status (from the HUD, a sheet, a journal mark) on a token
  Hooks.on("dropCanvasData", async (_canvas, data) => {
    if (!["tag", "status", "weakness"].includes(data?.type) || !data.name) return;
    const token = canvas.tokens.placeables.find(t => t.bounds?.contains(data.x, data.y));
    const actor = token?.actor;
    if (!actor || !(isHero(actor) || isChallenge(actor))) return;
    const value = parseInt(data.value) || 0;
    const isStatus = data.type === "status";
    const text = isStatus ? `${data.name}-${Math.max(1, value)}` : String(data.name);
    const opts = { forceStatus: isStatus };
    if (data.type === "weakness" || data.positive === "false" || data.positive === false) opts.positive = false;
    if (actor.isOwner) await addFloating(actor, text, opts);
    else relayToGM("addFloating", { actorUuid: actor.uuid, text, opts });
    ui.notifications.info(L("notify.dropped", { what: text, who: token.name }));
    return false;
  });
}

// ── Boot ─────────────────────────────────────────────────────────────────────

function boot() {
  if (!active()) return;
  registerHooks();
  if (game.ready) { onInit(); onReady(); }
  else {
    Hooks.once("init", onInit);
    Hooks.once("ready", onReady);
  }
}

if (globalThis.game?.system) boot();
else Hooks.once("init", () => { if (active()) { registerHooks(); onInit(); Hooks.once("ready", onReady); } });
