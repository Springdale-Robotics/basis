import {
  normalizeIngredientIdentity,
  calculateSimilarityWithReason,
} from './ingredient-matching.service.js';

/**
 * Working out what an import would add to the inventory, before it adds it.
 *
 * Importing a collection is the moment a household's inventory is founded, and
 * whatever it is founded on is what every later link, shopping list and stock
 * count inherits. The names arriving are typed by people who were writing for
 * themselves: "salt" on one card, "table salt" on another, "cinamon" where
 * "cinnamon" was meant. Left alone each becomes a separate item and the
 * duplicates are permanent, because nothing afterwards ever revisits them.
 *
 * Identical names already collapse — identity normalisation handles case,
 * hyphens and plurals. What it cannot do is decide that two *different* names
 * mean one thing, and it should not try: "kosher salt" and "table salt" score
 * as near-identical strings, and whether they are one item is a fact about a
 * particular kitchen rather than about the words. So this plans and proposes;
 * it never merges. The existing route says the same thing about near-matches
 * to stocked items — "reported, never substituted" — and this extends that to
 * the names arriving together, which had nothing comparing them at all.
 */

export interface PlannedItem {
  /** Every incoming name that normalises to this one identity. */
  originalNames: string[];
  /** The name the item would be given. */
  canonicalName: string;
  /** Whether this would attach to a stocked item or start a new one. */
  action: 'link' | 'create';
  /** Set when action is 'link'. */
  existingItemId?: string;
  existingItemName?: string;
  /**
   * Other new items in this same import that read like the same thing.
   * The gap this planner exists to close: nothing used to compare the
   * arriving names with each other, only with what was already stocked — so
   * on an empty inventory, every variant became its own item.
   */
  similarPlanned: Array<{ canonicalName: string; score: number; reason: string }>;
  /** Stocked items this resembles without matching outright. */
  similarExisting: Array<{ itemId: string; name: string; score: number; reason: string }>;
}

/**
 * A set of new items that all read like the same thing, so the household can
 * settle them in one decision instead of meeting the same pair twice.
 *
 * Built as connected components over the similarity pairs: if "salt" resembles
 * "table salt" and "table salt" resembles "sea salt", all three belong in one
 * conversation even where the first and last were never compared directly.
 */
export interface PlannedCluster {
  canonicalNames: string[];
  /** Strongest pairwise score in the cluster — for ordering the review. */
  topScore: number;
}

export interface ItemPlan {
  items: PlannedItem[];
  /** Groups of new items that resemble each other. */
  clusters: PlannedCluster[];
  /** Count of plans with at least one suggestion worth a decision. */
  needingReview: number;
}

export interface PlanInput {
  /** Incoming ingredient names paired with their canonical (CRF-tidied) form. */
  incoming: Array<{ name: string; canonicalName: string }>;
  /** What the household already stocks. */
  existing: Array<{ id: string; name: string }>;
  /** Score above which two names are worth showing the user side by side. */
  suggestionThreshold: number;
}

/**
 * Decide what an import would create or link, and what deserves a second look.
 * Pure: the caller does the CRF pass and the database reads.
 */
export function planIngredientItems(input: PlanInput): ItemPlan {
  const { incoming, existing, suggestionThreshold } = input;

  const existingByIdentity = new Map(
    existing.map((item) => [normalizeIngredientIdentity(item.name), item])
  );

  // One plan per distinct identity. Repeats across recipes are the common
  // case — an ingredient in eight recipes is one decision, not eight.
  const byIdentity = new Map<string, PlannedItem>();
  for (const { name, canonicalName } of incoming) {
    const chosenName = canonicalName.trim() || name;
    const identity = normalizeIngredientIdentity(chosenName);
    if (!identity) continue;

    const seen = byIdentity.get(identity);
    if (seen) {
      if (!seen.originalNames.includes(name)) seen.originalNames.push(name);
      continue;
    }

    const stocked = existingByIdentity.get(identity);
    byIdentity.set(identity, {
      originalNames: [name],
      canonicalName: stocked ? stocked.name : chosenName,
      action: stocked ? 'link' : 'create',
      existingItemId: stocked?.id,
      existingItemName: stocked?.name,
      similarPlanned: [],
      similarExisting: [],
    });
  }

  const plans = [...byIdentity.values()];
  const creating = plans.filter((p) => p.action === 'create');

  // Against what is already stocked.
  for (const plan of creating) {
    for (const item of existing) {
      const { score, reason } = calculateSimilarityWithReason(plan.canonicalName, item.name);
      if (score > suggestionThreshold) {
        plan.similarExisting.push({ itemId: item.id, name: item.name, score, reason });
      }
    }
    plan.similarExisting.sort((a, b) => b.score - a.score);
  }

  // And against each other — compared once per pair and recorded on both, so
  // whichever one the user is looking at shows the same suggestion.
  for (let i = 0; i < creating.length; i++) {
    for (let j = i + 1; j < creating.length; j++) {
      const a = creating[i];
      const b = creating[j];
      const { score, reason } = calculateSimilarityWithReason(a.canonicalName, b.canonicalName);
      if (score > suggestionThreshold) {
        a.similarPlanned.push({ canonicalName: b.canonicalName, score, reason });
        b.similarPlanned.push({ canonicalName: a.canonicalName, score, reason });
      }
    }
  }
  for (const plan of creating) {
    plan.similarPlanned.sort((x, y) => y.score - x.score);
  }

  return {
    items: plans,
    clusters: buildClusters(creating),
    needingReview: plans.filter(
      (p) => p.similarPlanned.length > 0 || p.similarExisting.length > 0
    ).length,
  };
}

/** Connected components over the similarity pairs recorded above. */
function buildClusters(creating: PlannedItem[]): PlannedCluster[] {
  const byName = new Map(creating.map((p) => [p.canonicalName, p]));
  const unvisited = new Set(byName.keys());
  const clusters: PlannedCluster[] = [];

  for (const start of byName.keys()) {
    if (!unvisited.has(start)) continue;
    unvisited.delete(start);

    const members: string[] = [start];
    let topScore = 0;
    const queue = [start];
    while (queue.length > 0) {
      const name = queue.shift()!;
      for (const neighbour of byName.get(name)?.similarPlanned ?? []) {
        topScore = Math.max(topScore, neighbour.score);
        if (unvisited.delete(neighbour.canonicalName)) {
          members.push(neighbour.canonicalName);
          queue.push(neighbour.canonicalName);
        }
      }
    }

    // A name resembling nothing is not a conversation.
    if (members.length > 1) clusters.push({ canonicalNames: members, topScore });
  }

  return clusters.sort((a, b) => b.topScore - a.topScore);
}
