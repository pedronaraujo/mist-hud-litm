// actions.js — Changes the HUD makes to Legend in the Mist documents.
//
// The HUD writes the same fields the system's character sheet writes
// (`selected`, `toBurn`, `burned`, `scratched`, floating tag entries...), so the
// sheet, the system roll dialog and the HUD always agree. Every array is written
// back whole, as the system itself does.

import { MODULE_ID, SOCKET_NAME, L } from "./constants.js";
import { sys, notifySystem } from "./system.js";
import { fellowshipThemecard } from "./data.js";

const clone = (v) => foundry.utils.deepClone(v ?? []);

/** Resolve the document holding a theme's tags: a themebook item, or the shared fellowship card. */
export function themeDoc(actor, source, docId) {
  if (source === "fellowship-themecard") return fellowshipThemecard(actor);
  return actor.items.get(docId) ?? null;
}

async function patchArray(doc, path, index, fn) {
  const arr = clone(foundry.utils.getProperty(doc, path));
  if (!arr[index]) return false;
  const next = fn({ ...arr[index] });
  if (next === false) return false;
  arr[index] = next;
  await doc.update({ [path]: arr });
  return true;
}

/** Only one tag per roll may burn for +3 (system issue #92): clear any other "to burn" mark. */
async function clearOtherBurns(actor, keepDoc, keepPath, keepIndex) {
  if (sys.clearOtherBurns) return sys.clearOtherBurns(actor, keepDoc, keepPath, keepIndex);
  const updates = [];
  const clear = (doc, path) => {
    const arr = foundry.utils.getProperty(doc, path);
    if (!Array.isArray(arr)) return;
    let changed = false;
    const next = arr.map((t, i) => {
      if (t.toBurn && !(doc === keepDoc && path === keepPath && i === keepIndex)) { changed = true; return { ...t, toBurn: false }; }
      return t;
    });
    if (changed) updates.push(doc.update({ [path]: next }));
  };
  for (const item of actor.items) {
    if (item.type === "themebook") clear(item, "system.powertags");
    else if (item.type === "backpack") clear(item, "system.items");
  }
  await Promise.all(updates);
}

// ── Theme / fellowship-card tags ────────────────────────────────────────────

export async function toggleThemeTag(actor, source, docId, kind, index) {
  const doc = themeDoc(actor, source, docId);
  if (!doc) return;
  const path = kind === "w" ? "system.weaknesstags" : "system.powertags";
  await patchArray(doc, path, index, t => {
    if (t.burned) return false;
    t.selected = !t.selected;
    if (!t.selected) t.toBurn = false;
    return t;
  });
  notifySystem(actor);
}

/**
 * Burn icon on a power tag: unburned → to burn (selected) → burned → unburned.
 * Fellowship theme tags are never burnt for Power (Core Book p. 138): their
 * icon only scratches / restores them.
 */
export async function cycleThemeTagBurn(actor, source, docId, index) {
  const doc = themeDoc(actor, source, docId);
  if (!doc) return;
  const path = "system.powertags";
  let willBurn = false;
  await patchArray(doc, path, index, t => {
    if (source === "fellowship-themecard") {
      t.burned = !t.burned; t.toBurn = false; if (t.burned) t.selected = false;
      return t;
    }
    if (t.burned) { t.burned = false; t.toBurn = false; t.selected = false; }
    else if (t.toBurn) { t.burned = true; t.toBurn = false; t.selected = false; }
    else { t.toBurn = true; t.selected = true; willBurn = true; }
    return t;
  });
  if (willBurn) await clearOtherBurns(actor, doc, path, index);
  notifySystem(actor);
}

// ── Backpack ─────────────────────────────────────────────────────────────────

export async function toggleBackpackTag(actor, itemId, index) {
  const bp = actor.items.get(itemId);
  if (!bp) return;
  await patchArray(bp, "system.items", index, t => {
    if (t.burned || t.expired) return false;
    t.selected = !t.selected;
    if (!t.selected) t.toBurn = false;
    return t;
  });
  notifySystem(actor);
}

export async function cycleBackpackBurn(actor, itemId, index) {
  const bp = actor.items.get(itemId);
  if (!bp) return;
  let willBurn = false;
  await patchArray(bp, "system.items", index, t => {
    if (t.expired) return false;
    if (t.burned) { t.burned = false; t.toBurn = false; t.selected = false; }
    else if (t.toBurn) { t.burned = true; t.toBurn = false; t.selected = false; }
    else { t.toBurn = true; t.selected = true; willBurn = true; }
    return t;
  });
  if (willBurn) await clearOtherBurns(actor, bp, "system.items", index);
  notifySystem(actor);
}

export async function addBackpackTag(actor, itemId, name) {
  let bp = actor.items.get(itemId) ?? actor.items.find(i => i.type === "backpack");
  if (!bp) {
    [bp] = await actor.createEmbeddedDocuments("Item", [{ name: "Backpack", type: "backpack" }]);
  }
  const arr = clone(bp.system.items);
  arr.push({ name, selected: false, burned: false, toBurn: false });
  await bp.update({ "system.items": arr });
}

export async function renameBackpackTag(actor, itemId, index, name) {
  const bp = actor.items.get(itemId);
  if (bp) await patchArray(bp, "system.items", index, t => ({ ...t, name }));
}

export async function deleteBackpackTag(actor, itemId, index) {
  const bp = actor.items.get(itemId);
  if (!bp) return;
  const arr = clone(bp.system.items);
  arr.splice(index, 1);
  await bp.update({ "system.items": arr });
  notifySystem(actor);
}

// ── Rotes ────────────────────────────────────────────────────────────────────

export async function toggleRote(actor, itemId) {
  const rote = actor.items.get(itemId);
  if (!rote) return;
  await rote.update({ "system.selected": !rote.system.selected });
  notifySystem(actor);
}

// ── Fellowship relationships ────────────────────────────────────────────────

export async function toggleRelationship(actor, index) {
  await patchArray(actor, "system.fellowships", index, f => {
    if (f.scratched) return false;
    f.selected = !f.selected;
    return f;
  });
  notifySystem(actor);
}

export async function toggleRelationshipScratch(actor, index) {
  await patchArray(actor, "system.fellowships", index, f => ({ ...f, scratched: !f.scratched, selected: false }));
  notifySystem(actor);
}

export async function addRelationship(actor, companion, relationshipTag) {
  const arr = clone(actor.system.fellowships);
  arr.push({ companion, relationshipTag, selected: false, scratched: false });
  await actor.update({ "system.fellowships": arr });
}

export async function setPromises(actor, n) {
  await actor.update({ "system.promises": Math.max(0, Math.min(5, n)) });
}

// ── Theme development tracks ────────────────────────────────────────────────

/** Click box i of a 3-box track: fill up to it, or empty it if it is the last filled one. */
export async function setTrack(actor, source, docId, track, boxIndex) {
  const doc = themeDoc(actor, source, docId);
  if (!doc || !["improve", "abandon", "milestone"].includes(track)) return;
  const cur = doc.system[track] ?? 0;
  const next = cur === boxIndex + 1 ? boxIndex : boxIndex + 1;
  await doc.update({ [`system.${track}`]: Math.max(0, Math.min(3, next)) });
}

// ── Floating tags & statuses (heroes and challenges) ─────────────────────────

const FTS = "system.floatingTagsAndStatuses";

/** Owner writes directly; anyone else asks the active GM over the socket. */
async function writeFloating(actor, fn) {
  if (actor.isOwner) {
    const next = fn(clone(actor.system.floatingTagsAndStatuses));
    if (next) await actor.update({ [FTS]: next });
    return true;
  }
  return false;
}

export async function toggleFloatingSelected(actor, index) {
  await writeFloating(actor, arr => {
    if (!arr[index]) return null;
    arr[index].selected = !arr[index].selected;
    return arr;
  });
  notifySystem(actor);
}

/** Status click: neutral → helping (+) → hindering (−) → neutral. */
export async function cycleStatus(actor, index) {
  await writeFloating(actor, arr => {
    const e = arr[index];
    if (!e) return null;
    if (!e.selected) { e.selected = true; e.positive = true; }
    else if (e.positive !== false) { e.positive = false; }
    else { e.selected = false; }
    return arr;
  });
  notifySystem(actor);
}

export async function toggleFloatingPolarity(actor, index) {
  await writeFloating(actor, arr => {
    if (!arr[index]) return null;
    arr[index].positive = arr[index].positive === false;
    return arr;
  });
  notifySystem(actor);
}

export async function deleteFloating(actor, index) {
  await writeFloating(actor, arr => { arr.splice(index, 1); return arr; });
  notifySystem(actor);
}

export async function updateFloating(actor, index, { name, tier, positive, isStatus }) {
  await writeFloating(actor, arr => {
    const e = arr[index];
    if (!e) return null;
    if (name !== undefined) e.name = name;
    if (positive !== undefined) e.positive = positive;
    if (isStatus !== undefined) e.isStatus = isStatus;
    if (tier !== undefined) {
      const t = Math.max(0, Math.min(6, tier));
      e.markings = Array.from({ length: 6 }, (_, i) => i === t - 1);
      e.value = t;
      if (t > 0) e.isStatus = true;
    }
    return arr;
  });
}

/**
 * Parse "name", "name-3" or "/sn name-3" (negative) the way the system does,
 * and add it to the list, stacking a same-named status on the tracking card
 * (Core Book p. 29).
 */
export function addParsedToList(list, text, { forceStatus = false, positive } = {}) {
  const A = sys.FloatingTagAndStatusAdapter;
  let entry;
  if (A) entry = A.parseFloatingTagAndStatusString(text);
  else {
    const m = /^(.*?)-(\d+)$/.exec(text.trim());
    entry = { name: m ? m[1].trim() : text.trim(), isStatus: !!m, value: m ? +m[2] : 0, positive: true, markings: Array(6).fill(false) };
    if (m && entry.value > 0 && entry.value <= 6) entry.markings[entry.value - 1] = true;
  }
  if (forceStatus && !entry.isStatus) {
    entry.isStatus = true; entry.value = 1; entry.markings = [true, false, false, false, false, false];
  }
  if (positive !== undefined) entry.positive = positive;
  entry.selected = false;
  return A ? A.withStatusStacked(list, entry) : [...list, entry];
}

export async function addFloating(actor, text, opts = {}) {
  if (!text?.trim()) return;
  if (actor.isOwner) {
    await actor.update({ [FTS]: addParsedToList(clone(actor.system.floatingTagsAndStatuses), text, opts) });
  } else {
    relayToGM("addFloating", { actorUuid: actor.uuid, text, opts });
  }
}

// ── GM relay (drops on tokens the player does not own) ───────────────────────

export function relayToGM(action, payload) {
  if (!game.users.activeGM) {
    ui.notifications.warn(L("notify.noGM"));
    return;
  }
  game.socket.emit(SOCKET_NAME, { action, ...payload, userId: game.user.id });
}

export function registerSocket() {
  game.socket.on(SOCKET_NAME, async (data) => {
    if (!game.user.isGM || game.user.id !== game.users.activeGM?.id) return;
    try {
      if (data?.action === "addFloating") {
        const actor = await fromUuid(String(data.actorUuid));
        if (!actor || !["litm-character", "litm-npc"].includes(actor.type)) return;
        const text = String(data.text ?? "").slice(0, 120);
        const opts = { forceStatus: !!data.opts?.forceStatus };
        if (data.opts?.positive !== undefined) opts.positive = !!data.opts.positive;
        await actor.update({ [FTS]: addParsedToList(clone(actor.system.floatingTagsAndStatuses), text, opts) });
      }
    } catch (e) {
      console.error(`${MODULE_ID} | relayed action failed`, e);
    }
  });
}
