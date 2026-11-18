// data.js — Read Legend in the Mist actor data into the shapes the HUD templates use.
//
// Everything here is read-only. The system stores the selection itself on the
// documents (`selected`, `toBurn`, `burned` on each tag entry), so the HUD, the
// character sheet and the system's roll dialog always show the same state.

import { THEME_CATEGORY, L } from "./constants.js";
import { markup } from "./system.js";

const filled = (t) => !!(t?.name && String(t.name).trim().length);

export const burnState = (t) => t.burned ? "burned" : t.toBurn ? "toBurn" : "unburned";

/**
 * Per-roll inversion key, identical to the system's DiceRollApp.getTagKey() for
 * the tag shapes built in DiceRollApp.getPreparedTagsAndStatusesForRoll().
 */
export function tagKey(source, docId, kind, index) {
  if (source === "backpack") return `backpack:b:${index + 1}`;
  if (source === "fellowship-themecard") return `fellowship-themecard:${kind}:${index}`;
  return `${docId}:${kind}:${index}`;
}

/** The shared Fellowship theme card actor of a hero, if any. */
export function fellowshipThemecard(actor) {
  const id = actor?.system?.actorSharedSingleThemecardId;
  return id ? (game.actors.get(id) ?? null) : null;
}

function trackArray(value, max = 3) {
  return Array.from({ length: max }, (_, i) => i < (value ?? 0));
}

function themeFromDoc(doc, { source, inverted, category, typeLabel, isStory = false }) {
  const sysData = doc.system;
  const docId = doc.id;
  const powerTags = (sysData.powertags ?? []).map((t, index) => ({ ...t, index }))
    .filter(t => filled(t) && !t.planned)
    .map(t => {
      const key = tagKey(source, docId, "p", t.index);
      return {
        index: t.index, name: t.name, selected: !!t.selected,
        burnState: burnState(t), isTitle: t.index === 0,
        expired: !!t.expired,
        canBurn: source !== "fellowship-themecard",
        key, inverted: inverted.has(key),
      };
    });
  const weaknessTags = (sysData.weaknesstags ?? []).map((t, index) => ({ ...t, index }))
    .filter(filled)
    .map(t => {
      const key = tagKey(source, docId, "w", t.index);
      return {
        index: t.index, name: t.name, selected: !!t.selected,
        key, inverted: inverted.has(key),
      };
    });
  const specials = (sysData.specialImprovements ?? [])
    .filter(s => s.active && (s.name || s.description))
    .map(s => ({ name: s.name, description: s.description }));

  return {
    id: docId, uuid: doc.uuid, source, isStory,
    name: doc.name, category, typeLabel,
    quest: sysData.quest ?? "",
    improve: sysData.improve ?? 0, abandon: sysData.abandon ?? 0, milestone: sysData.milestone ?? 0,
    improveTrack: trackArray(sysData.improve), abandonTrack: trackArray(sysData.abandon),
    milestoneTrack: trackArray(sysData.milestone),
    readyToImprove: (sysData.improve ?? 0) >= 3,
    specials, powerTags, weaknessTags,
    hasTags: powerTags.length + weaknessTags.length > 0,
  };
}

/**
 * Everything the player HUD shows for a hero.
 * @param {Actor} actor  a litm-character
 * @param {Set<string>} inverted  per-roll inversion keys held by the HUD
 */
export function getHeroData(actor, inverted = new Set()) {
  const items = actor.items.contents;
  const themebooks = items.filter(i => i.type === "themebook");

  // Main-tab themes first (sheet order), story themes / "other" tab after them
  const ordered = [
    ...themebooks.filter(i => !i.system.options?.isStoryTheme && i.system.tabCategory !== "other"),
    ...themebooks.filter(i => !i.system.options?.isStoryTheme && i.system.tabCategory === "other"),
    ...themebooks.filter(i => i.system.options?.isStoryTheme),
  ];
  const themes = ordered.map(item => {
    const isStory = !!item.system.options?.isStoryTheme;
    const category = isStory ? "Extra" : (THEME_CATEGORY[item.system.type] ?? "Default");
    const typeLabel = isStory ? L("hud.storyTheme")
      : L(`hud.themeType.${category}`);
    return themeFromDoc(item, { source: "themebook", inverted, category, typeLabel, isStory });
  }).filter(t => t.hasTags || t.name);

  // Fellowship theme card (shared actor)
  const card = fellowshipThemecard(actor);
  const fellowshipTheme = card ? themeFromDoc(card, {
    source: "fellowship-themecard", inverted, category: "Crew", typeLabel: L("hud.fellowship"),
  }) : null;

  // Backpack (story tags owned by the hero)
  const backpackItem = items.find(i => i.type === "backpack");
  const backpack = backpackItem ? {
    id: backpackItem.id,
    name: backpackItem.name,
    tags: (backpackItem.system.items ?? []).map((t, index) => ({ ...t, index })).filter(filled).map(t => {
      const key = tagKey("backpack", backpackItem.id, "b", t.index);
      return {
        index: t.index, name: t.name, selected: !!t.selected && !t.expired,
        burnState: burnState(t), expired: !!t.expired, expiring: !!t.expiring,
        key, inverted: inverted.has(key),
      };
    }),
  } : null;

  // Rotes: their title works as a tag (Core Book p. 98)
  const rotes = items.filter(i => i.type === "rote")
    .map(i => ({ id: i.id, name: i.name, selected: !!i.system.selected, actionType: i.system.actionType }));

  const quintessences = items.filter(i => i.type === "quintessence")
    .map(i => ({ id: i.id, name: i.name, description: i.system.description ?? "" }));

  // Floating tags and statuses on the hero
  const floating = (actor.system.floatingTagsAndStatuses ?? []).map((e, index) => ({ ...e, index }));
  const isStatus = (e) => e.isStatus === true || (e.value ?? 0) > 0;
  const storyTags = floating.filter(e => !isStatus(e) && filled(e)).map(e => ({
    index: e.index, name: e.name, selected: !!e.selected, positive: e.positive !== false,
  }));
  const statuses = floating.filter(e => isStatus(e) && filled(e)).map(e => {
    const positive = e.positive !== false;
    return {
      index: e.index, name: e.name, tier: e.value ?? 0, positive, selected: !!e.selected,
      statusType: e.selected ? (positive ? "positive" : "negative") : "neutral",
      markings: e.markings ?? [],
    };
  });

  // Fellowship relationships (Core Book p. 138)
  const relationships = (actor.system.fellowships ?? []).map((f, index) => ({
    index, companion: f.companion ?? "", name: f.relationshipTag ?? "",
    selected: !!f.selected && !f.scratched, scratched: !!f.scratched,
  })).filter(r => r.name.trim() || r.companion.trim());

  const improvements = [...themes, ...(fellowshipTheme ? [fellowshipTheme] : [])]
    .filter(t => t.specials.length)
    .map(t => ({ id: t.id, name: t.name, category: t.category, specials: t.specials }));

  return {
    themes, fellowshipTheme, backpack, rotes, quintessences, storyTags, statuses,
    relationships, promises: actor.system.promises ?? 0, improvements,
    isOvercome: !!actor.system.isOvercome,
  };
}

// ── Challenges (litm-npc) ────────────────────────────────────────────────────

/** Everything the challenge HUD shows for a litm-npc actor. */
export function getChallengeData(actor) {
  const s = actor.system;
  const floating = (s.floatingTagsAndStatuses ?? []).map((e, index) => ({ ...e, index }));
  const isStatus = (e) => e.isStatus === true || (e.value ?? 0) > 0;
  const tags = floating.filter(e => !isStatus(e) && filled(e)).map(e => ({
    index: e.index, name: e.name, selected: !!e.selected, positive: e.positive !== false,
  }));
  const statuses = floating.filter(e => isStatus(e) && filled(e)).map(e => ({
    index: e.index, name: e.name, tier: e.value ?? 0, positive: e.positive !== false,
    selected: !!e.selected,
  }));
  const limits = (s.limits ?? []).filter(l => filled(l)).map(l => ({
    name: l.name, value: l.value, reached: !!l.reached, consequence: markup(l.consequence),
  }));
  const threats = (s.threatsAndConsequences ?? []).filter(t => t.name || t.description).map(t => ({
    name: t.name, description: markup(t.description),
    consequences: (t.list ?? []).filter(c => c && String(c).trim()).map(markup),
  }));
  const mighty = (s.mightyAspects ?? []).filter(m => m.aspect).map(m => ({
    aspect: markup(m.aspect), icon: m.mightIcon || m.level || "",
  }));
  const specials = (s.specialFeatures ?? []).filter(f => f.name || f.description)
    .map(f => ({ name: f.name, description: markup(f.description) }));
  const secrets = (s.secrets ?? []).filter(f => f.name || f.description)
    .map(f => ({ name: f.name, description: markup(f.description) }));

  return {
    difficulty: s.difficulty ?? 0,
    roles: (s.roles ?? []).filter(Boolean),
    description: markup(s.shortDescription),
    hasDescription: !!(s.shortDescription && s.shortDescription.trim()),
    tags, statuses, limits, threats, mighty, specials, secrets,
    isOvercome: !!s.isOvercome,
  };
}
