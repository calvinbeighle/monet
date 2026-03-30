/**
 * components/ConnectionRow.tsx
 * Displays a single external service connection in the sidebar.
 * Shows the service name, icon, and a connect/connected button.
 */
import { Mail, GitBranch, Calendar, FileText } from 'lucide-react';
import type { Connection } from '../types';

interface ConnectionRowProps {
  connection: Connection;
}

/** Maps service icon name to a Lucide icon component */
function ServiceIcon({ icon, size = 14 }: { icon: string; size?: number }) {
  const props = { size, strokeWidth: 1.5 };
  const iconMap: Record<string, React.ReactNode> = {
    gmail: <Mail {...props} />,
    github: <GitBranch {...props} />,
    calendar: <Calendar {...props} />,
    notion: <FileText {...props} />,
  };
  return <>{iconMap[icon] ?? <FileText {...props} />}</>;
}

/**
 * Renders a connection row with an icon, service name, and status button.
 * The button is cosmetic for now.
 */
export function ConnectionRow({ connection }: ConnectionRowProps) {
  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-all duration-150"
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-elevated)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = 'transparent';
      }}
    >
      {/* Service icon in small circle */}
      <span
        className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
        style={{
          background: 'var(--surface-elevated)',
          color: 'var(--text-secondary)',
        }}
      >
        <ServiceIcon icon={connection.icon} size={12} />
      </span>

      {/* Service name */}
      <span
        className="flex-1 text-sm truncate"
        style={{ color: 'var(--text-primary)', fontSize: '13px' }}
      >
        {connection.service}
      </span>

      {/* Status button */}
      {connection.connected ? (
        <span
          className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
          style={{
            color: 'var(--success)',
            background: 'rgba(34, 197, 94, 0.1)',
            fontSize: '10px',
            fontWeight: 500,
          }}
        >
          Connected
        </span>
      ) : (
        <button
          className="text-xs px-2 py-0.5 rounded-full flex-shrink-0 transition-colors duration-150 cursor-pointer"
          style={{
            color: 'var(--text-muted)',
            background: 'var(--surface-elevated)',
            border: '1px solid var(--border-strong)',
            fontSize: '10px',
            fontWeight: 500,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
          }}
        >
          Connect
        </button>
      )}
    </div>
  );
}
