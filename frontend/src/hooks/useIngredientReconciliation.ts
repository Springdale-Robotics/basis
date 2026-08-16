import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { recipesApi } from '@/api/recipes';
import type {
  ReconcileResolution,
  StockedLookAlike,
} from '@/components/recipes/ReconcileIngredientsDialog';

/** The bits of an ingredient match this needs. */
export interface UnmatchedIngredient {
  parsedName: string;
  parsedUnit?: string;
}

type Plan = Awaited<ReturnType<typeof recipesApi.planItemsForIngredients>>;

/**
 * Creating inventory items from recipe ingredients, with the look-alikes
 * settled first.
 *
 * Both import dialogs offer "create everything unmatched", and both used to
 * post straight to create-items — which inserts, then mentions near-matches
 * afterwards. That offers a decision about rows that already exist, and at the
 * one moment it matters most: founding a household's inventory, where the
 * duplicates are permanent because nothing later revisits them.
 *
 * So the plan is fetched first, and if it raises anything the caller shows the
 * dialog. When there is nothing to settle this is invisible — no dialog, no
 * extra click, no change to the existing flow.
 *
 * Living in one hook because it was going to be needed in two dialogs, and a
 * second copy of a matching rule only ever drifts from the first.
 */
export function useIngredientReconciliation(
  /** Point a recipe's ingredient at the item it resolved to. */
  onMatched: (parsedName: string, itemId: string, itemName: string) => void,
  /** Surfaced when the server couldn't tidy the names (CRF down). */
  onWarnings?: (warnings: string[]) => void
) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<{ unmatched: UnmatchedIngredient[]; plan: Plan } | null>(
    null
  );
  const [isSaving, setIsSaving] = useState(false);

  const createItems = useCallback(
    async (
      toCreate: Array<{ name: string; unit?: string }>,
      /** Names resolved without being sent: merged away, or already stocked. */
      resolvedElsewhere: Array<{ from: string; toItemId?: string; toItemName?: string; viaName?: string }>
    ) => {
      let results: Awaited<ReturnType<typeof recipesApi.createItemsForIngredients>>['results'] = [];
      if (toCreate.length > 0) {
        const created = await recipesApi.createItemsForIngredients(toCreate);
        results = created.results;
        if (created.warnings.length > 0) onWarnings?.(created.warnings);
      }
      const byRequestedName = new Map(results.map((r) => [r.originalName, r]));

      for (const result of results) {
        onMatched(result.originalName, result.itemId, result.itemName);
      }

      for (const entry of resolvedElsewhere) {
        if (entry.toItemId && entry.toItemName) {
          // Already stocked — no creation involved at all.
          onMatched(entry.from, entry.toItemId, entry.toItemName);
        } else if (entry.viaName) {
          // Merged away, so nothing came back under its own name. Point it at
          // whatever the group it joined turned into.
          const target = byRequestedName.get(entry.viaName);
          if (target) onMatched(entry.from, target.itemId, target.itemName);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
      queryClient.invalidateQueries({ queryKey: ['ingredient-suggestions'] });
    },
    [onMatched, onWarnings, queryClient]
  );

  /** Look-alikes against the household's stock, as the dialog wants them. */
  const stockedLookAlikes = useCallback(
    (plan: Plan): StockedLookAlike[] =>
      plan.items
        .filter((item) => item.action === 'create' && item.similarExisting.length > 0)
        .map((item) => ({
          canonicalName: item.canonicalName,
          candidates: item.similarExisting.map((s) => ({
            itemId: s.itemId,
            name: s.name,
            score: s.score,
          })),
        })),
    []
  );

  /**
   * Ask what would be created. Returns true when the caller should show the
   * dialog, false when it went ahead because there was nothing to settle.
   */
  const begin = useCallback(
    async (unmatched: UnmatchedIngredient[]) => {
      if (unmatched.length === 0) return false;

      const plan = await recipesApi.planItemsForIngredients(
        unmatched.map((m) => ({ name: m.parsedName }))
      );

      if (plan.clusters.length === 0 && stockedLookAlikes(plan).length === 0) {
        await createItems(
          unmatched.map((m) => ({ name: m.parsedName, unit: m.parsedUnit })),
          []
        );
        return false;
      }

      setPending({ unmatched, plan });
      return true;
    },
    [createItems, stockedLookAlikes]
  );

  /**
   * Apply what the household decided, then create what remains.
   *
   * The plan talks in canonical names while recipes talk in whatever they were
   * written with, so every decision is translated back through the original
   * names before anything is sent.
   */
  const resolve = useCallback(
    async (resolution: ReconcileResolution) => {
      if (!pending) return;
      const { unmatched, plan } = pending;

      const itemFor = (canonicalName: string) =>
        plan.items.find((i) => i.canonicalName === canonicalName);
      const planOf = (parsedName: string) =>
        plan.items.find((i) => i.originalNames.includes(parsedName));

      const settled = new Set<string>();
      const resolvedElsewhere: Array<{
        from: string;
        toItemId?: string;
        toItemName?: string;
        viaName?: string;
      }> = [];

      for (const { keepName, mergedNames } of resolution.merges) {
        const via = itemFor(keepName)?.originalNames[0];
        if (!via) continue;
        for (const name of mergedNames) {
          settled.add(name);
          for (const original of itemFor(name)?.originalNames ?? []) {
            resolvedElsewhere.push({ from: original, viaName: via });
          }
        }
      }

      for (const { canonicalName, itemId, itemName } of resolution.useExisting) {
        settled.add(canonicalName);
        for (const original of itemFor(canonicalName)?.originalNames ?? []) {
          resolvedElsewhere.push({ from: original, toItemId: itemId, toItemName: itemName });
        }
      }

      const toCreate = unmatched
        .filter((m) => !settled.has(planOf(m.parsedName)?.canonicalName ?? ''))
        .map((m) => ({ name: m.parsedName, unit: m.parsedUnit }));

      setIsSaving(true);
      try {
        await createItems(toCreate, resolvedElsewhere);
      } finally {
        setIsSaving(false);
        setPending(null);
      }
    },
    [pending, createItems]
  );

  return {
    begin,
    isSaving,
    /** Props for ReconcileIngredientsDialog, or null when nothing is pending. */
    dialogProps: pending
      ? {
          open: true as const,
          clusters: pending.plan.clusters,
          stocked: stockedLookAlikes(pending.plan),
          onCancel: () => setPending(null),
          onConfirm: resolve,
          isSaving,
        }
      : null,
  };
}
