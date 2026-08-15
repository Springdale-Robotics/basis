import { useState } from 'react';
import { Merge, Link2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ReconcileCluster {
  canonicalNames: string[];
  topScore: number;
}

/** A name about to be created that resembles something already stocked. */
export interface StockedLookAlike {
  canonicalName: string;
  candidates: Array<{ itemId: string; name: string; score: number }>;
}

export interface ReconcileResolution {
  /** Groups of new names folded into one. */
  merges: Array<{ keepName: string; mergedNames: string[] }>;
  /** New names the household says are really a stocked item. */
  useExisting: Array<{ canonicalName: string; itemId: string; itemName: string }>;
}

interface Props {
  open: boolean;
  clusters: ReconcileCluster[];
  stocked: StockedLookAlike[];
  onCancel: () => void;
  onConfirm: (resolution: ReconcileResolution) => void;
  isSaving?: boolean;
}

/**
 * Settling look-alike ingredient names before any of them become items.
 *
 * Recipes are written by people writing for themselves, so a collection
 * arrives saying "salt" on one card and "table salt" on another, and "cinamon"
 * where "cinnamon" was meant. Each becomes its own inventory item and stays
 * that way, because nothing afterwards revisits them — and every later link,
 * shopping list and stock count inherits the split.
 *
 * Nothing here is decided automatically. "Kosher salt" and "table salt"
 * resemble each other exactly as strongly as "salt" and "table salt" do, and
 * whether they are one item is a fact about a kitchen rather than about the
 * words. So everything defaults to staying as it is, and both merging and
 * reusing a stocked item are deliberate choices — made once, then remembered.
 */
export function ReconcileIngredientsDialog({
  open,
  clusters,
  stocked,
  onCancel,
  onConfirm,
  isSaving = false,
}: Props) {
  // Absent means "leave it alone", which is the default for every row.
  const [keepChoice, setKeepChoice] = useState<Map<number, string>>(new Map());
  const [existingChoice, setExistingChoice] = useState<Map<string, { itemId: string; itemName: string }>>(
    new Map()
  );

  const mergedAwayCount = [...keepChoice.entries()].reduce(
    (total, [index]) => total + clusters[index].canonicalNames.length - 1,
    0
  );
  const decidedCount = mergedAwayCount + existingChoice.size;

  const confirm = () => {
    onConfirm({
      merges: [...keepChoice.entries()].map(([index, keepName]) => ({
        keepName,
        mergedNames: clusters[index].canonicalNames.filter((n) => n !== keepName),
      })),
      useExisting: [...existingChoice.entries()].map(([canonicalName, item]) => ({
        canonicalName,
        itemId: item.itemId,
        itemName: item.itemName,
      })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Check these before they become items</DialogTitle>
          <DialogDescription>
            Anything you leave alone becomes its own item — often the right answer, since a kitchen
            can stock both kosher and table salt. Nothing has been saved yet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[50vh] overflow-y-auto">
          {clusters.length > 0 && (
            <section className="space-y-2">
              <h4 className="text-sm font-medium">These look like the same ingredient</h4>
              {clusters.map((cluster, index) => {
                const keepName = keepChoice.get(index);
                return (
                  <div
                    key={cluster.canonicalNames.join('|')}
                    className={cn(
                      'rounded-lg border p-3 space-y-2',
                      keepName && 'border-primary/40 bg-primary/5'
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-1.5 text-sm">
                      {cluster.canonicalNames.map((name, i) => (
                        <span key={name} className="flex items-center gap-1.5">
                          {i > 0 && <span className="text-xs text-muted-foreground">and</span>}
                          <span
                            className={cn(
                              'rounded bg-muted px-1.5 py-0.5 font-medium',
                              keepName && name !== keepName && 'line-through opacity-60'
                            )}
                          >
                            {name}
                          </span>
                        </span>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={keepName ? 'ghost' : 'secondary'}
                        onClick={() =>
                          setKeepChoice((prev) => {
                            const next = new Map(prev);
                            next.delete(index);
                            return next;
                          })
                        }
                      >
                        Keep separate
                      </Button>
                      {cluster.canonicalNames.map((name) => (
                        <Button
                          key={name}
                          type="button"
                          size="sm"
                          variant={keepName === name ? 'default' : 'outline'}
                          onClick={() => setKeepChoice((prev) => new Map(prev).set(index, name))}
                        >
                          <Merge className="mr-1.5 h-3.5 w-3.5" />
                          All are &ldquo;{name}&rdquo;
                        </Button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          {stocked.length > 0 && (
            <section className="space-y-2">
              <h4 className="text-sm font-medium">You may already stock these</h4>
              {stocked.map((entry) => {
                const chosen = existingChoice.get(entry.canonicalName);
                return (
                  <div
                    key={entry.canonicalName}
                    className={cn(
                      'rounded-lg border p-3 space-y-2',
                      chosen && 'border-primary/40 bg-primary/5'
                    )}
                  >
                    <p className="text-sm">
                      <span
                        className={cn(
                          'rounded bg-muted px-1.5 py-0.5 font-medium',
                          chosen && 'line-through opacity-60'
                        )}
                      >
                        {entry.canonicalName}
                      </span>
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={chosen ? 'ghost' : 'secondary'}
                        onClick={() =>
                          setExistingChoice((prev) => {
                            const next = new Map(prev);
                            next.delete(entry.canonicalName);
                            return next;
                          })
                        }
                      >
                        Create it anyway
                      </Button>
                      {entry.candidates.map((candidate) => (
                        <Button
                          key={candidate.itemId}
                          type="button"
                          size="sm"
                          variant={chosen?.itemId === candidate.itemId ? 'default' : 'outline'}
                          onClick={() =>
                            setExistingChoice((prev) =>
                              new Map(prev).set(entry.canonicalName, {
                                itemId: candidate.itemId,
                                itemName: candidate.name,
                              })
                            )
                          }
                        >
                          <Link2 className="mr-1.5 h-3.5 w-3.5" />
                          Use &ldquo;{candidate.name}&rdquo;
                        </Button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel} disabled={isSaving}>
            Back
          </Button>
          <Button onClick={confirm} disabled={isSaving}>
            {decidedCount > 0 ? `Save, resolving ${decidedCount}` : 'Save, all separate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
