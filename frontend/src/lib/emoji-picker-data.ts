// Searchable emoji picker using unicode-emoji-json
// Full Unicode emoji database with name-based search

import emojiData from 'unicode-emoji-json';

export interface EmojiEntry {
  emoji: string;
  name: string;
  group: string;
  extraKeywords?: string[];
}

// Relevant groups for home inventory context (skip flags, most symbols)
const RELEVANT_GROUPS = new Set([
  'Food & Drink',
  'Travel & Places',
  'Objects',
  'Animals & Nature',
  'Activities',
  'People & Body',
  'Smileys & Emotion',
]);

// Extra keywords for common search terms not in unicode names
const EXTRA_KEYWORDS: Record<string, string[]> = {
  '🍳': ['kitchen', 'stove', 'oven', 'cooktop'],
  '❄️': ['freezer', 'fridge', 'refrigerator', 'cold storage'],
  '🧊': ['freezer', 'fridge', 'refrigerator', 'cold'],
  '🥶': ['freezer', 'fridge', 'refrigerator'],
  '🗄️': ['cabinet', 'pantry', 'cupboard', 'closet', 'storage'],
  '🚿': ['bathroom', 'shower room', 'washroom'],
  '🛁': ['bathroom', 'washroom'],
  '🛏️': ['bedroom', 'sleep'],
  '🛋️': ['living room', 'lounge', 'den'],
  '🪑': ['dining room', 'chair'],
  '📦': ['storage', 'box', 'container', 'moving'],
  '🧰': ['toolbox', 'garage', 'workshop', 'tools'],
  '🚗': ['garage', 'carport', 'driveway'],
  '🌳': ['garden', 'yard', 'outdoor', 'backyard'],
  '🪴': ['plant room', 'greenhouse', 'indoor garden'],
  '🧹': ['closet', 'utility', 'cleaning closet', 'laundry'],
  '🧺': ['laundry room', 'laundry', 'utility room'],
  '👕': ['closet', 'wardrobe', 'dresser', 'laundry'],
  '💊': ['medicine cabinet', 'pharmacy', 'first aid'],
  '🍼': ['nursery', 'baby room'],
  '🧸': ['playroom', 'kids room', 'toy room', 'nursery'],
  '🎮': ['game room', 'rec room', 'entertainment'],
  '📚': ['library', 'study', 'bookshelf', 'office'],
  '💻': ['office', 'desk', 'workspace', 'study'],
  '🏋️': ['gym', 'workout room', 'exercise room', 'fitness'],
  '🍷': ['wine cellar', 'bar', 'liquor cabinet'],
  '🍺': ['bar', 'kegerator', 'beer fridge'],
  '☕': ['coffee station', 'breakfast nook', 'cafe'],
  '🧯': ['utility room', 'safety', 'emergency'],
  '🔧': ['workshop', 'garage', 'tool shed'],
  '🏕️': ['camping gear', 'outdoor storage'],
  '🛖': ['shed', 'outbuilding', 'workshop'],
  '🏠': ['home', 'main house'],
  '🏡': ['home', 'garden shed'],
  '🐾': ['pet supplies', 'pet area'],
  '🐕': ['dog', 'kennel', 'pet'],
  '🐈': ['cat', 'pet'],
  '🎄': ['holiday storage', 'seasonal', 'decorations', 'attic'],
  '🚪': ['entry', 'hallway', 'mudroom', 'closet'],
  '🔑': ['entry', 'key rack', 'front door'],
  '🪟': ['windowsill', 'sunroom'],
  '🍽️': ['dining room', 'dinner table'],
  '🥫': ['pantry', 'canned goods', 'food storage'],
  '🫙': ['pantry', 'preserves', 'canning', 'spice rack'],
};

// Build the emoji database once at import time
const ALL_EMOJIS: EmojiEntry[] = Object.entries(emojiData)
  .filter(([, data]) => RELEVANT_GROUPS.has(data.group))
  .map(([emoji, data]) => ({
    emoji,
    name: data.name,
    group: data.group,
    extraKeywords: EXTRA_KEYWORDS[emoji],
  }));

// Priority emojis that show first when no search (common for home inventory)
const PRIORITY_EMOJIS = new Set([
  '🏠', '🏡', '🍳', '❄️', '🧊', '🗄️', '🚿', '🛁', '🛏️', '🛋️',
  '📦', '🧰', '🧹', '🧺', '🚗', '🌳', '🪴', '🍽️', '🔪', '💊',
  '🧴', '🧼', '🍼', '🐾', '📚', '💡', '🔑', '🔌', '👕', '🧸',
  '🎮', '🏋️', '⛱️', '🛖', '🪑', '🚪', '🍷', '☕', '🥫', '🫙',
]);

const PRIORITY_LIST = ALL_EMOJIS.filter(e => PRIORITY_EMOJIS.has(e.emoji));
const REST_LIST = ALL_EMOJIS.filter(e => !PRIORITY_EMOJIS.has(e.emoji));
const DEFAULT_ORDER = [...PRIORITY_LIST, ...REST_LIST];

/**
 * Search emojis by name. Returns matching entries sorted by relevance.
 * Empty query returns priority emojis first, then the rest.
 */
export function searchEmojis(query: string, limit = 50): EmojiEntry[] {
  const q = query.toLowerCase().trim();
  if (!q) return DEFAULT_ORDER.slice(0, limit);

  const words = q.split(/\s+/);

  const scored: { entry: EmojiEntry; score: number }[] = [];

  for (const entry of ALL_EMOJIS) {
    const name = entry.name.toLowerCase();
    const searchText = entry.extraKeywords
      ? name + ' ' + entry.extraKeywords.join(' ')
      : name;
    let score = 0;

    // Exact name match
    if (name === q) {
      score = 100;
    }
    // Name starts with query
    else if (name.startsWith(q)) {
      score = 90;
    }
    // Name contains full query
    else if (name.includes(q)) {
      score = 70;
    }
    // Extra keywords exact match
    else if (entry.extraKeywords?.some(kw => kw.toLowerCase() === q)) {
      score = 85;
    }
    // Extra keywords contain query
    else if (entry.extraKeywords?.some(kw => kw.toLowerCase().includes(q))) {
      score = 65;
    }
    // All words match somewhere in searchText
    else if (words.every(w => searchText.includes(w))) {
      score = 60;
    }
    // Any word matches in searchText
    else if (words.some(w => searchText.includes(w))) {
      score = 30 + (words.filter(w => searchText.includes(w)).length / words.length) * 20;
    }

    if (score > 0) {
      scored.push({ entry, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.entry);
}
