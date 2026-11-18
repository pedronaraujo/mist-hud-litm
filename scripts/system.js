// system.js — Access to the Legend in the Mist system's own classes.
//
// The system (mist-engine-fvtt) does not expose its roll dialog or helpers on a
// global. They are loaded here from the very URLs the system itself is served
// from, so the module gets the system's own class instances (same singletons,
// same static state). A missing file never stops the module from loading: it is
// reported once and the HUD falls back where it can.

const FILES = {
  DiceRollApp:                 "module/apps/dice-roll-app.mjs",
  RollConfirmation:            "module/lib/roll-confirmation.mjs",
  FloatingTagAndStatusAdapter: "module/lib/floating-tag-and-status-adapter.mjs",
  textWithTags:                "module/lib/tag-status-text-helper.mjs",
  clearOtherBurns:             "module/lib/burn-helper.mjs",
};

/** @type {{DiceRollApp?: any, RollConfirmation?: any, FloatingTagAndStatusAdapter?: any, textWithTags?: Function, clearOtherBurns?: Function}} */
export const sys = {};
const failures = [];

export const systemReady = Promise.all(Object.entries(FILES).map(async ([name, file]) => {
  try {
    const mod = await import(foundry.utils.getRoute(`systems/mist-engine-fvtt/${file}`));
    if (!mod[name]) throw new Error(`${file} has no export named ${name}`);
    sys[name] = mod[name];
  } catch (e) {
    console.error(`Mist HUD (LitM) | Failed to load system file ${file}:`, e);
    failures.push(file);
  }
})).then(() => {
  if (!failures.length) return;
  const report = () => ui.notifications.error(
    game.i18n.format("MistHUD.notify.systemLoadFailed", { files: failures.join(", ") }),
    { permanent: true });
  if (globalThis.game?.ready) report(); else Hooks.once("ready", report);
});

/** The system's scene app singleton (scene/story tags, challenge selection), if any. */
export const sceneApp = () => globalThis.MistSceneApp?.instance ?? null;

/** Let the system's open windows (roll dialog, scene app) pick up a selection change. */
export function notifySystem(actor) {
  try {
    const app = sys.DiceRollApp?.instance;
    if (app?.rendered && app.actor?.id === actor?.id) app.updateTagsAndStatuses(true);
  } catch (e) { console.warn("Mist HUD (LitM) | roll dialog refresh failed", e); }
  try { sceneApp()?.sendUpdateHookEvent?.(false); } catch (e) { /* not open */ }
}

/** Convert the system's [tag] / [/s status-2] markup to its draggable marks. */
export function markup(text) {
  if (!text) return "";
  try { return sys.textWithTags ? sys.textWithTags(String(text)) : foundry.utils.escapeHTML?.(String(text)) ?? String(text); }
  catch { return String(text); }
}
