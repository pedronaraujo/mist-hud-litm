// roll.js — Power preview and rolls through the system's own roll engine.
//
// Quick / Detailed / Reaction rolls are made by the system's DiceRollApp
// (dice-roll-app.mjs): same Power maths, same chat cards, same post-roll clean
// up (burning the tag marked to burn, marking Improve for weaknesses,
// scratching fellowship tags, clearing the selection, GM confirmation, Dice So
// Nice...). The HUD only feeds it the per-roll inversions and the modifier.

import { L } from "./constants.js";
import { sys, systemReady, sceneApp } from "./system.js";

export const ROLL_TYPES = ["quick", "detailed", "reaction"];
export const SACRIFICE_LEVELS = ["painful", "scarring", "grave"];

/** Selected tags of the hero, with the HUD's per-roll inversions applied (as DiceRollApp.prepareTags does). */
function preparedTags(actor, inverted) {
  const D = sys.DiceRollApp;
  const tags = D.getPreparedTagsAndStatusesForRoll(actor);
  for (const t of tags) {
    if (t.weakness || t.powerTag || t.source === "backpack") {
      const key = D.getTagKey(t);
      t.inverted = inverted.has(key) && !t.toBurn;
      if (t.inverted) t.positive = !t.positive;
    }
  }
  return tags;
}

/** Scene, story, GM-modifier and challenge tags currently selected in the system's scene app. */
function sceneSelections() {
  const app = sceneApp();
  const gm = [], story = [], challenge = [];
  if (!app) return { gm, story, challenge };
  try {
    for (const e of app.getRollModifications?.() ?? [])
      gm.push({ name: e.name, positive: e.positive, source: "gm", value: e.value });
    for (const e of app.getSceneAndStoryTags?.() ?? [])
      if (e.selected) story.push({ name: e.name, positive: e.positive, source: "scene-and-story", value: e.value });
    for (const e of app.getCombinedSelectedNPCTags?.() ?? [])
      if (e.selected) challenge.push({ name: e.name, positive: e.positive, source: "npc", value: e.value, actorId: e.actorId });
  } catch (e) { console.warn("Mist HUD (LitM) | scene selection unavailable", e); }
  return { gm, story, challenge };
}

/**
 * Power the next roll would have, as the system computes it:
 * tags +1 (burned +3, one per roll), highest helping and hindering status
 * only, scene/challenge selections, modifier and Might. Never below 1.
 */
export function previewPower(actor, { inverted = new Set(), modifier = 0, might = 0 } = {}) {
  const D = sys.DiceRollApp;
  if (!D || !actor) return null;
  try {
    const own = preparedTags(actor, inverted);
    const { gm, story, challenge } = sceneSelections();
    const used = D.applyRulesToSelectedTags(own, gm, story, challenge);
    const count = D.calculatePowerTags(used);
    const raw = count.positive - count.negative + modifier + might;
    return { power: Math.max(1, raw), raw, positive: count.positive, negative: count.negative, count: own.length + story.length + challenge.length };
  } catch (e) {
    console.warn("Mist HUD (LitM) | power preview failed", e);
    return null;
  }
}

/**
 * Make a Quick / Detailed / Reaction roll.
 * @param {"direct"|"dialog"} mode  direct: roll now; dialog: open the system roll dialog prefilled
 * @returns {Promise<boolean>} true when the roll went out (or the dialog opened)
 */
export async function rollAction(actor, type, { inverted, modifier = 0, might = 0, mode = "direct" } = {}) {
  await systemReady;
  const D = sys.DiceRollApp;
  if (!D) { ui.notifications.error(L("notify.rollApiUnavailable")); return false; }

  const app = D.getInstance({ actor, type });
  // getInstance clears inversions when it switches actor: set ours afterwards
  app.invertedTags = new Set(inverted ?? []);
  app.numModPositive = Math.max(0, modifier);
  app.numModNegative = Math.max(0, -modifier);
  app.mightScale = game.settings.get("mist-engine-fvtt", "mightUsageEnabled") ? might : 0;
  app.updateTagsAndStatuses();

  if (mode === "dialog") {
    await app.render(true, { focus: true });
    return true;
  }

  const formValues = { numModPositive: app.numModPositive, numModNegative: app.numModNegative, mightScale: app.mightScale };
  if (sys.RollConfirmation?.needsConfirmation?.()) {
    // The Narrator asked to confirm every roll: the system dialog shows the wait
    await app.render(true, { focus: true });
    app.requestGmConfirmation(formValues);
    return true;
  }
  await app.executeRoll(formValues);
  return true;
}

/**
 * Making a Sacrifice (Core Book p. 134): a roll without Power, only the
 * Narrator's modifier. 10+ Miracle, 7-9 Fate, 6- In Vain. Uses the system's
 * own chat card.
 */
export async function rollSacrifice(actor, level, { modifier = 0 } = {}) {
  let formula = "2d6";
  if (modifier > 0) formula += ` + ${modifier}`;
  else if (modifier < 0) formula += ` - ${Math.abs(modifier)}`;
  const roll = await new Roll(formula, actor.getRollData()).evaluate();
  if (game.dice3d) await game.dice3d.showForRoll(roll, game.user, true, null, false);

  const outcome = roll.total >= 10 ? "miracle" : roll.total >= 7 ? "fate" : "invain";
  const lessened = { grave: "scarring", scarring: "painful", painful: "none" }[level];
  const loc = (k) => game.i18n.localize(`MIST_ENGINE.SACRIFICE.Levels.${k}`);
  const html = await foundry.applications.handlebars.renderTemplate(
    "systems/mist-engine-fvtt/templates/chat/sacrifice-result.hbs",
    {
      diceRollHTML: await roll.render(),
      levelLabel: loc(level),
      lessenedLabel: loc(lessened),
      isMiracle: outcome === "miracle",
      isFate: outcome === "fate",
      isInVain: outcome === "invain",
    });
  await ChatMessage.create({ content: html, speaker: ChatMessage.getSpeaker({ actor }) });
  return true;
}
