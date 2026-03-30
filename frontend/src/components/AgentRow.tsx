/**
 * components/AgentRow.tsx
 * Renders a single agent as a row in the sidebar.
 * Shows agent name, status badge, and a progress bar when the agent is running.
 */
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type { Agent } from '@/types';

/** Color map for agent status badges */
const STATUS_COLORS: Record<Agent['status'], string> = {
  running: 'bg-green-500/20 text-green-400 border-green-500/30',
  idle: 'bg-zinc-700/50 text-zinc-400 border-zinc-600/30',
  error: 'bg-red-500/20 text-red-400 border-red-500/30',
};

interface AgentRowProps {
  agent: Agent;
}

/**
 * Renders a single agent row with name, status badge, optional summary text,
 * and a progress bar for running agents.
 */
export function AgentRow({ agent }: AgentRowProps) {
  const isRunning = agent.status === 'running';

  return (
    <div className="flex flex-col gap-1.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-zinc-200 font-medium truncate">{agent.name}</span>
        <Badge
          variant="outline"
          className={`text-[10px] px-1.5 py-0 h-4 shrink-0 ${STATUS_COLORS[agent.status]}`}
        >
          {agent.status}
        </Badge>
      </div>

      {isRunning && agent.summary && (
        <p className="text-xs text-zinc-500 truncate">{agent.summary}</p>
      )}

      {!isRunning && agent.lastRun && (
        <p className="text-xs text-zinc-600">Last run: {agent.lastRun}</p>
      )}

      {isRunning && agent.progress !== undefined && (
        <Progress
          value={agent.progress}
          className="h-1 bg-zinc-800"
        />
      )}
    </div>
  );
}
