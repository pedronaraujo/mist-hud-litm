// constants.js — Module-wide constants for Mist Engine HUD (Legend in the Mist)

export const MODULE_ID = "mist-hud-litm";
export const SYSTEM_ID = "mist-engine-fvtt";
export const SOCKET_NAME = `module.${MODULE_ID}`;

/**
 * Root URL path of this module's files, derived from where this script was
 * served from. Lets the module run from any folder name (and from a test copy)
 * without hard-coded "modules/<id>/" paths.
 */
export const MODULE_ROOT = globalThis.__MHL_ROOT__ ?? new URL("../", import.meta.url).pathname.replace(/^\//, "");

/** Path of a file inside this module, relative to the Foundry route root. */
export const modulePath = (rel) => `${MODULE_ROOT}${rel}`;

export const SETTINGS = {
  ROLL_MODE:          "rollMode",            // "direct" | "dialog"
  AUTO_OPEN:          "autoOpen",            // open HUD on token control
  NPC_HUD_ON_TOKEN:   "npcHudOnTokenHud",    // GM: open challenge HUD from the token HUD
  USE_TEXT_BUTTONS:   "useTextButtons",
  WIDE_LAYOUT:        "wideLayout",
  NPC_COLLAPSED:      "npcDescriptionCollapsed",
  HUD_POSITION:       "hudPosition",
};

/** Themebook type (system.type) → HUD category used by the CSS. */
export const THEME_CATEGORY = {
  "litm-origin":    "Origin",
  "litm-adventure": "Adventure",
  "litm-greatness": "Greatness",
  "litm-variable":  "Default",
};

export const L = (key, data) =>
  data ? game.i18n.format(`MistHUD.${key}`, data) : game.i18n.localize(`MistHUD.${key}`);

export const isHero  = (actor) => actor?.type === "litm-character";
export const isChallenge = (actor) => actor?.type === "litm-npc";

export function debug(...args) {
  if (game.settings?.settings?.has(`${MODULE_ID}.debug`) && game.settings.get(MODULE_ID, "debug")) {
    console.log("Mist HUD (LitM) |", ...args);
  }
}

/**
 * Attach single-click and double-click handlers to one element without the
 * double-click also firing the single-click action twice.
 */
export function onClicks(el, single, double, delay = 230) {
  let timer = null;
  el.addEventListener("click", ev => {
    ev.preventDefault(); ev.stopPropagation();
    if (!double) return single(ev);
    if (timer) { clearTimeout(timer); timer = null; return; }
    timer = setTimeout(() => { timer = null; single(ev); }, delay);
  });
  if (double) el.addEventListener("dblclick", ev => {
    ev.preventDefault(); ev.stopPropagation();
    clearTimeout(timer); timer = null;
    double(ev);
  });
}
