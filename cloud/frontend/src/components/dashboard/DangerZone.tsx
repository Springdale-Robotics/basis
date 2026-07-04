import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { isApiError } from '@/api/client';
import { revokeToken } from '@/api/tenants';
import { Alert, Button, Card } from '@/components/ui';
import { useInvalidate } from '@/hooks/queries';

export function DangerZone() {
  const [arming, setArming] = useState(false);
  const invalidate = useInvalidate();

  const revoke = useMutation({
    mutationFn: revokeToken,
    onSuccess: () => {
      setArming(false);
      invalidate.tenant();
    },
  });

  return (
    <Card className="border-red-200">
      <h2 className="text-base font-semibold text-red-800">Danger zone</h2>
      <p className="mt-2 text-sm leading-relaxed text-stone-600">
        Revoking the tunnel token disconnects your box within about a minute
        and blocks it from reconnecting. Use this if the box was stolen or you
        suspect the token leaked. Reconnect any time with a fresh claim code.
      </p>

      {revoke.isSuccess && (
        <Alert tone="success" className="mt-4">
          Token revoked. Your box will disconnect shortly — generate a new
          claim code above when you're ready to reconnect.
        </Alert>
      )}
      {revoke.isError && (
        <Alert tone="error" className="mt-4">
          {isApiError(revoke.error)
            ? revoke.error.message
            : 'Could not revoke the token. Try again.'}
        </Alert>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {arming ? (
          <>
            <Button
              variant="danger"
              busy={revoke.isPending}
              onClick={() => revoke.mutate()}
            >
              Yes, revoke the token
            </Button>
            <Button
              variant="ghost"
              onClick={() => setArming(false)}
              disabled={revoke.isPending}
            >
              Keep it
            </Button>
          </>
        ) : (
          <Button variant="danger" onClick={() => setArming(true)}>
            Revoke tunnel token
          </Button>
        )}
        {arming && (
          <span className="text-sm text-red-700">
            Are you sure? Your box goes offline until you claim it again.
          </span>
        )}
      </div>
    </Card>
  );
}
