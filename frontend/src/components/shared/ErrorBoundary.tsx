import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { bugReportsApi } from '@/api/bug-reports';
import { getConsoleBuffer } from '@/lib/consoleBuffer';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// Error signatures already reported this session — a render loop repeatedly
// tripping the boundary must not spam the bug-reports API.
const reportedErrors = new Set<string>();

function reportCrash(error: Error, errorInfo: ErrorInfo) {
  try {
    const signature = `${error.name}: ${error.message}`;
    if (reportedErrors.has(signature)) return;
    reportedErrors.add(signature);

    const stack = (error.stack ?? '').slice(0, 4000);
    const componentStack = (errorInfo.componentStack ?? '').slice(0, 2000);
    // Fire-and-forget; a failed report must never make the crash worse.
    void bugReportsApi
      .create({
        description: [
          `[auto] Unhandled render error: ${signature}`,
          stack,
          componentStack && `Component stack:${componentStack}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
        url: window.location.pathname + window.location.search,
        userAgent: navigator.userAgent.slice(0, 500),
        consoleLog: getConsoleBuffer(),
        viewport: { w: window.innerWidth, h: window.innerHeight },
      })
      .catch(() => {
        /* offline or API down — nothing else to do */
      });
  } catch {
    /* reporting is best-effort */
  }
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    reportCrash(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertTriangle className="h-12 w-12 text-destructive" />
          <h2 className="mt-4 text-lg font-semibold">Something went wrong</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-md">
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <Button
            className="mt-4"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try again
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
