import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cloud, KeyRound, Server } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { llmApi, type AiBackend, type AiBackendState } from '@/api/llm';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/api-error';

/**
 * The box-wide "Where AI runs" switch. Choosing Claude only takes effect once
 * a key has been checked with Anthropic, so the radio never shows Claude
 * selected on a box that can't actually use it.
 */
export function AiBackendCard() {
  const queryClient = useQueryClient();
  const { data: state, isLoading } = useQuery({
    queryKey: ['llm', 'backend'],
    queryFn: () => llmApi.getBackend(),
  });

  const [keyInput, setKeyInput] = useState('');
  const [keyFormOpen, setKeyFormOpen] = useState(false);
  // True when the key form was opened by choosing Claude: saving then also
  // switches over. Replacing the key on a box set to local must not.
  const [switchOnSave, setSwitchOnSave] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const applyState = (next: AiBackendState) => {
    queryClient.setQueryData(['llm', 'backend'], next);
    // The model cards and recipe/receipt status depend on the backend.
    queryClient.invalidateQueries({ queryKey: ['llm'] });
  };

  const backendMutation = useMutation({
    mutationFn: (backend: AiBackend) => llmApi.setBackend(backend),
    onSuccess: (next) => {
      applyState(next);
      toast({
        title: next.backend === 'claude' ? 'AI now runs on Claude' : 'AI now runs on this server',
      });
    },
    onError: (error) => toast({ title: 'Could not change where AI runs', description: getErrorMessage(error), variant: 'destructive' }),
  });

  const saveKeyMutation = useMutation({
    mutationFn: async ({ apiKey, switchToClaude }: { apiKey: string; switchToClaude: boolean }) => {
      const saved = await llmApi.saveClaudeKey(apiKey);
      return switchToClaude && saved.backend !== 'claude' ? llmApi.setBackend('claude') : saved;
    },
    onSuccess: (next) => {
      applyState(next);
      setKeyInput('');
      setKeyFormOpen(false);
      setSwitchOnSave(false);
      setKeyError(null);
      toast({
        title: 'Claude API key saved',
        description: next.backend === 'claude' ? 'AI now runs on Claude.' : undefined,
      });
    },
    onError: (error) => setKeyError(getErrorMessage(error)),
  });

  const removeKeyMutation = useMutation({
    mutationFn: () => llmApi.removeClaudeKey(),
    onSuccess: (next) => {
      applyState(next);
      setConfirmRemove(false);
      toast({ title: 'Claude API key removed', description: 'AI now runs on this server.' });
    },
    onError: (error) => toast({ title: 'Could not remove the key', description: getErrorMessage(error), variant: 'destructive' }),
  });

  if (isLoading || !state) return <Skeleton className="h-40" />;

  const showKeyForm = keyFormOpen || state.keyState === 'unreadable';

  const handleChoose = (value: string) => {
    const backend = value as AiBackend;
    if (backend === 'claude' && state.keyState !== 'set') {
      // No usable key yet: open the key field; the switch happens on save.
      setKeyFormOpen(true);
      setSwitchOnSave(true);
      return;
    }
    // Choosing this server abandons any half-entered key and its error.
    setKeyFormOpen(false);
    setSwitchOnSave(false);
    setKeyInput('');
    setKeyError(null);
    backendMutation.mutate(backend);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5" />
          Where AI runs
        </CardTitle>
        <CardDescription>
          Applies to photo import, receipt scanning and recipe text, for everyone on this server.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup
          value={state.backend ?? ''}
          onValueChange={handleChoose}
          disabled={backendMutation.isPending || saveKeyMutation.isPending}
          className="space-y-3"
        >
          <div className="flex items-start gap-3">
            <RadioGroupItem value="local" id="ai-backend-local" className="mt-1" />
            <Label htmlFor="ai-backend-local" className="font-normal leading-snug">
              <span className="font-medium">This server (Ollama)</span>
              <span className="block text-sm text-muted-foreground">Nothing leaves this box.</span>
            </Label>
          </div>
          <div className="flex items-start gap-3">
            <RadioGroupItem value="claude" id="ai-backend-claude" className="mt-1" />
            <Label htmlFor="ai-backend-claude" className="font-normal leading-snug">
              <span className="flex items-center gap-1.5 font-medium">
                <Cloud className="h-4 w-4" />
                Claude API (Anthropic)
              </span>
              <span className="block text-sm text-muted-foreground">
                Photos, receipt text and recipe text are sent to Anthropic to be read.
              </span>
            </Label>
          </div>
        </RadioGroup>

        {state.backend === null && (
          <p className="text-sm text-muted-foreground">Not chosen yet — Basis is using its default setup.</p>
        )}

        {state.keyState === 'unreadable' && (
          <Alert variant="destructive">
            <AlertDescription>The saved key can't be read — please re-enter it.</AlertDescription>
          </Alert>
        )}

        {state.keyState === 'set' && !showKeyForm && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">API key</span>
              <code className="rounded bg-muted px-2 py-0.5 text-sm">{state.keyHint}</code>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setKeyFormOpen(true)}>
                  Replace
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmRemove(true)}>
                  Remove
                </Button>
              </div>
            </div>
            {state.backend === 'claude' && state.model && (
              <p className="text-sm text-muted-foreground">
                Uses {state.model.displayName} (newest Haiku). Typical cost: under $1/month.
              </p>
            )}
          </div>
        )}

        {showKeyForm && (
          <form
            className="space-y-2 rounded-md border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              setKeyError(null);
              saveKeyMutation.mutate({
                apiKey: keyInput,
                switchToClaude: switchOnSave || state.backend === 'claude',
              });
            }}
          >
            <Label htmlFor="claude-api-key">Claude API key</Label>
            <Input
              id="claude-api-key"
              type="password"
              autoComplete="off"
              placeholder="sk-ant-…"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              Create one at console.anthropic.com. It's checked with Anthropic before it's saved, and stored
              encrypted on this server.
            </p>
            {keyError && <p className="text-sm text-destructive">{keyError}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={!keyInput.trim() || saveKeyMutation.isPending}>
                {saveKeyMutation.isPending ? 'Checking…' : 'Save key'}
              </Button>
              {state.keyState !== 'unreadable' && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setKeyFormOpen(false);
                    setSwitchOnSave(false);
                    setKeyInput('');
                    setKeyError(null);
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </form>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove the Claude API key?"
        description="AI features will switch to This server."
        confirmText="Remove key"
        variant="destructive"
        isPending={removeKeyMutation.isPending}
        onConfirm={() => removeKeyMutation.mutate()}
      />
    </Card>
  );
}
