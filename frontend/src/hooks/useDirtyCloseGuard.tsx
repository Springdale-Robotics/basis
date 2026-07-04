import { useCallback, useState } from 'react';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';

interface UseDirtyCloseGuardOptions {
  /**
   * Whether there are unsaved changes right now. Accepts a value or a lazy
   * predicate (useful when the check is non-trivial to compute).
   */
  isDirty: boolean | (() => boolean);
  /**
   * Actually close the dialog (and reset any local state). Called directly
   * when clean, or after the user confirms discarding when dirty.
   */
  onDiscard: () => void;
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
}

/**
 * Shared "Discard changes?" guard for dialogs with unsaved form state.
 *
 * Route every close path (Radix `onOpenChange(false)` — which covers Escape
 * and outside-click — plus explicit Cancel buttons) through `requestClose`.
 * When clean the dialog closes immediately; when dirty a destructive
 * ConfirmDialog asks first. Render `confirmDialog` alongside the dialog.
 */
export function useDirtyCloseGuard({
  isDirty,
  onDiscard,
  title = 'Discard changes?',
  description = 'You have unsaved changes. Closing will discard them.',
  confirmText = 'Discard',
  cancelText = 'Keep editing',
}: UseDirtyCloseGuardOptions) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const requestClose = useCallback(() => {
    const dirty = typeof isDirty === 'function' ? isDirty() : isDirty;
    if (dirty) {
      setConfirmOpen(true);
    } else {
      onDiscard();
    }
  }, [isDirty, onDiscard]);

  const confirmDialog = (
    <ConfirmDialog
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      title={title}
      description={description}
      confirmText={confirmText}
      cancelText={cancelText}
      variant="destructive"
      onConfirm={() => {
        setConfirmOpen(false);
        onDiscard();
      }}
    />
  );

  return { requestClose, confirmDialog };
}
