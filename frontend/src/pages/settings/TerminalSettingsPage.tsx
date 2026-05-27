import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ShieldAlert } from 'lucide-react';
import { PtyTerminal } from '@/components/settings/PtyTerminal';

export function TerminalSettingsPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Terminal</CardTitle>
        <CardDescription>
          Freeform shell on the host this server runs on. Useful for one-off
          maintenance, but not a substitute for SSH for everyday work.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Same access as the backend user</AlertTitle>
          <AlertDescription>
            This shell runs as the same OS user as the homemanager backend.
            Anything that user can do, you can do here — including{' '}
            <code className="rounded bg-muted px-1">sudo</code> (you'll be prompted
            for the host password). Treat this like an SSH session: don't leave
            it open on a shared computer, don't paste commands you don't
            understand.
          </AlertDescription>
        </Alert>

        <PtyTerminal commandId="shell-bash" />
      </CardContent>
    </Card>
  );
}
