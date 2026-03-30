/**
 * components/ConnectionPills.tsx
 * Renders a horizontal row of tool connection pills on the home screen.
 *
 * Each pill shows a service icon + name + status indicator.
 * Disconnected pills are clickable and trigger the OAuth flow in a popup window.
 * Connected pills display a green dot and muted text - they are non-interactive.
 * The entire row is hidden once all tools are connected.
 *
 * OAuth flow:
 *   1. User clicks a disconnected pill
 *   2. POST /connect/{service} returns a redirect URL
 *   3. URL opens in a 600x700 popup window
 *   4. Frontend polls GET /connections every 3 seconds until the service connects
 *   5. Pill updates to connected state, poll stops
 */
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mail,
  GitBranch,
  MessageSquare,
  Calendar,
  FileText,
} from 'lucide-react';
import type { Connection } from '@/types';
import { BACKEND_URL } from '@/types';

/** Tool definition used to render each pill */
interface ToolDef {
  id: string;
  name: string;
  /** Lucide icon component to render */
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }>;
  /** Brand color for the icon */
  color: string;
}

/** All tools that can appear in the connection row */
const TOOLS: ToolDef[] = [
  { id: 'gmail', name: 'Gmail', Icon: Mail, color: '#ea4335' },
  { id: 'github', name: 'GitHub', Icon: GitBranch, color: '#8b5cf6' },
  { id: 'slack', name: 'Slack', Icon: MessageSquare, color: '#e01e5a' },
  { id: 'calendar', name: 'Calendar', Icon: Calendar, color: '#4285f4' },
  { id: 'notion', name: 'Notion', Icon: FileText, color: '#ffffff' },
];

interface ConnectionPillProps {
  tool: ToolDef;
  connection: Connection | undefined;
  /** Called when the user clicks a disconnected pill to initiate OAuth */
  onConnect: (serviceId: string) => void;
  /** True while this service is in the middle of the OAuth flow */
  isConnecting: boolean;
}

/**
 * Renders a single connection pill for one service.
 * Disconnected: zinc-900 bg, zinc-400 text, subtle border - clickable.
 * Connected: same bg but green dot indicator, zinc-600 text - not clickable.
 * Connecting: pulsing violet border while OAuth popup is open.
 */
function ConnectionPill({ tool, connection, onConnect, isConnecting }: ConnectionPillProps) {
  const isConnected = connection?.connected ?? false;
  const { Icon } = tool;

  const handleClick = () => {
    if (!isConnected && !isConnecting) {
      onConnect(tool.id);
    }
  };

  return (
    <motion.button
      onClick={handleClick}
      disabled={isConnected || isConnecting}
      animate={
        isConnecting
          ? { boxShadow: ['0 0 0 1px rgba(139,92,246,0.3)', '0 0 0 1px rgba(139,92,246,0.8)', '0 0 0 1px rgba(139,92,246,0.3)'] }
          : { boxShadow: '0 0 0 0px rgba(139,92,246,0)' }
      }
      transition={isConnecting ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
      whileHover={!isConnected && !isConnecting ? { borderColor: 'rgba(255,255,255,0.14)' } : {}}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        height: '32px',
        padding: '0 12px',
        borderRadius: '9999px',
        background: '#111111',
        border: `1px solid ${isConnecting ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.06)'}`,
        cursor: isConnected || isConnecting ? 'default' : 'pointer',
        flexShrink: 0,
        transition: 'border-color 0.15s ease',
      }}
    >
      {/* Green connected dot - only shown when service is connected */}
      <AnimatePresence>
        {isConnected && (
          <motion.span
            key="dot"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.2 }}
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#22c55e',
              flexShrink: 0,
            }}
          />
        )}
      </AnimatePresence>

      {/* Service icon - colored per brand */}
      <Icon
        size={14}
        strokeWidth={1.5}
        style={{ color: isConnected ? 'rgba(255,255,255,0.3)' : tool.color, flexShrink: 0 }}
      />

      {/* Service name */}
      <span
        style={{
          fontSize: '13px',
          color: isConnected ? 'rgba(161,161,170,0.4)' : 'rgba(161,161,170,0.85)',
          letterSpacing: '-0.01em',
          lineHeight: 1,
          whiteSpace: 'nowrap',
        }}
      >
        {tool.name}
      </span>
    </motion.button>
  );
}

interface ConnectionPillsProps {
  connections: Connection[];
  onConnect: (serviceId: string) => void;
  /** Set of service IDs currently in the OAuth flow */
  connectingIds: Set<string>;
}

/**
 * Renders the full connection pills row.
 * Shows a subtle section header + horizontal pill row.
 * If all tools are connected, renders nothing (the parent should hide this via AnimatePresence).
 */
export function ConnectionPills({ connections, onConnect, connectingIds }: ConnectionPillsProps) {
  const connectionMap = new Map(connections.map((c) => [c.id, c]));
  const hasDisconnected = TOOLS.some((t) => !(connectionMap.get(t.id)?.connected ?? false));

  if (!hasDisconnected) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '10px',
      }}
    >
      {/* Section label - 11px uppercase, very subtle */}
      <span
        style={{
          fontSize: '11px',
          fontWeight: 500,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'rgba(161,161,170,0.35)',
        }}
      >
        Connect your tools
      </span>

      {/* Pill row */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '8px',
        }}
      >
        {TOOLS.map((tool) => (
          <ConnectionPill
            key={tool.id}
            tool={tool}
            connection={connectionMap.get(tool.id)}
            onConnect={onConnect}
            isConnecting={connectingIds.has(tool.id)}
          />
        ))}
      </div>
    </motion.div>
  );
}

/**
 * Initiates OAuth for a service by opening a popup window and polling until connected.
 *
 * Opens a 600x700 centered popup with the OAuth redirect URL returned by the backend.
 * Polls GET /connections every 3 seconds until the service shows as connected.
 * Automatically stops polling after 2 minutes to prevent infinite loops.
 *
 * @param serviceId - The lowercase service name (e.g. 'gmail', 'github')
 * @param onStatusChange - Called with true when polling starts, false when it stops
 * @param onConnected - Called when the service becomes connected
 */
export async function initiateOAuthFlow(
  serviceId: string,
  onStatusChange: (isConnecting: boolean) => void,
  onConnected: () => void,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}/connect/${serviceId}`, { method: 'POST' });
  } catch {
    console.error(`Failed to reach backend for /connect/${serviceId}`);
    return;
  }

  if (!res.ok) return;

  const data = await res.json();
  // Backend returns { oauth_url: "..." } or { redirect_url: "..." }
  const redirectUrl: string | undefined = data.oauth_url ?? data.redirect_url;
  if (!redirectUrl) return;

  // Calculate centered popup position
  const width = 600;
  const height = 700;
  const left = Math.round(window.screenX + (window.outerWidth - width) / 2);
  const top = Math.round(window.screenY + (window.outerHeight - height) / 2);

  window.open(
    redirectUrl,
    'monet_oauth',
    `width=${width},height=${height},left=${left},top=${top},popup=yes,noopener=yes`,
  );

  onStatusChange(true);

  // Poll every 3 seconds until connected or timed out (2 minutes)
  const pollIntervalMs = 3_000;
  const timeoutMs = 120_000;
  const startedAt = Date.now();

  const poll = setInterval(async () => {
    if (Date.now() - startedAt > timeoutMs) {
      clearInterval(poll);
      onStatusChange(false);
      return;
    }

    try {
      const r = await fetch(`${BACKEND_URL}/connections`);
      if (!r.ok) return;
      const result = await r.json();
      const conns: Array<{ id: string; connected: boolean }> = result.connections ?? result;
      const found = conns.find((c) => c.id === serviceId);
      if (found?.connected) {
        clearInterval(poll);
        onStatusChange(false);
        onConnected();
      }
    } catch {
      // Ignore transient network errors during polling
    }
  }, pollIntervalMs);
}
