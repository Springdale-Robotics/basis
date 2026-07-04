import { useState } from 'react';
import { Loader2, Globe, Cloud, Network, Laptop, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type SetupRemoteMode =
  | 'basis_remote'
  | 'local'
  | 'cloudflare'
  | 'tailscale'
  | 'custom';

interface RemoteAccessSetupProps {
  onSubmit: (mode: SetupRemoteMode) => void;
  onSkip: () => void;
  isLoading: boolean;
}

const options: Array<{
  id: SetupRemoteMode;
  label: string;
  description: string;
  icon: typeof Globe;
  badge?: string;
}> = [
  {
    id: 'basis_remote',
    label: 'Basis Remote',
    description: 'yourname.home-basis.com — one code, we handle the rest',
    icon: Zap,
    badge: 'Recommended',
  },
  {
    id: 'local',
    label: 'Local Only',
    description: 'Only accessible on your local network',
    icon: Laptop,
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare Tunnel',
    description: 'Secure remote access through Cloudflare',
    icon: Cloud,
  },
  {
    id: 'tailscale',
    label: 'Tailscale',
    description: 'Access through your Tailscale network',
    icon: Network,
  },
  {
    id: 'custom',
    label: 'Custom Domain',
    description: 'Use your own domain with DDNS',
    icon: Globe,
  },
];

export function RemoteAccessSetup({ onSubmit, onSkip, isLoading }: RemoteAccessSetupProps) {
  const [selected, setSelected] = useState<SetupRemoteMode>('local');

  return (
    <div>
      <div className="mb-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Globe className="h-6 w-6 text-primary" />
        </div>
        <h2 className="text-xl font-semibold">Remote Access</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose how you want to access Basis remotely.
        </p>
      </div>

      <div className="space-y-3">
        {options.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setSelected(option.id)}
              className={cn(
                'flex w-full items-center gap-4 rounded-lg border p-4 text-left transition-colors',
                selected === option.id
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-muted/50'
              )}
            >
              <div
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-full',
                  selected === option.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                )}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="font-medium">
                  {option.label}
                  {option.badge && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      {option.badge}
                    </span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  {option.description}
                </p>
              </div>
              <div
                className={cn(
                  'h-4 w-4 rounded-full border-2',
                  selected === option.id
                    ? 'border-primary bg-primary'
                    : 'border-muted-foreground'
                )}
              />
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex gap-3">
        <Button variant="outline" onClick={onSkip} className="flex-1">
          Skip for now
        </Button>
        <Button
          onClick={() => onSubmit(selected)}
          disabled={isLoading}
          className="flex-1"
        >
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Continue
        </Button>
      </div>
    </div>
  );
}
