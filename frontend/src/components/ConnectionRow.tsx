/**
 * components/ConnectionRow.tsx
 * Renders a single external service connection row in the sidebar.
 * Shows the service name and a Connect/Connected action button.
 */
import { Button } from '@/components/ui/button';
import type { Connection } from '@/types';

interface ConnectionRowProps {
  connection: Connection;
}

/**
 * Renders a connection row with service name and connect/connected toggle button.
 * Connected services show a subtle green-tinted outline button.
 */
export function ConnectionRow({ connection }: ConnectionRowProps) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-zinc-300">{connection.service}</span>
      <Button
        variant="outline"
        size="sm"
        className={`h-6 text-[11px] px-2 ${
          connection.connected
            ? 'border-green-500/40 text-green-400 hover:bg-green-500/10'
            : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
        }`}
      >
        {connection.connected ? 'Connected' : 'Connect'}
      </Button>
    </div>
  );
}
