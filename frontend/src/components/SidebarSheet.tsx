/**
 * components/SidebarSheet.tsx
 * shadcn Sheet-based sidebar that slides in from the left.
 * Three sections: Agents (with status badges + progress bars),
 * Connections (with connect/connected buttons), Activity (last 5 events).
 */
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AgentRow } from './AgentRow';
import { ConnectionRow } from './ConnectionRow';
import { ActivityItem } from './ActivityItem';
import { useAppStore } from '@/stores/appStore';

/** Small uppercase section label */
function SectionLabel({ label }: { label: string }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600 mb-2">
      {label}
    </p>
  );
}

/**
 * SidebarSheet renders a Sheet that slides in from the left when sidebarOpen is true.
 * It reads and modifies sidebarOpen from the Zustand store.
 */
export function SidebarSheet() {
  const { sidebarOpen, toggleSidebar, agents, connections, activity } = useAppStore();

  /** Last 5 activity events */
  const recentActivity = activity.slice(0, 5);

  return (
    <Sheet open={sidebarOpen} onOpenChange={toggleSidebar}>
      <SheetContent
        side="left"
        className="w-72 p-0 border-r border-zinc-800 bg-zinc-950"
      >
        <SheetHeader className="px-5 pt-5 pb-3">
          <SheetTitle className="text-sm font-semibold text-zinc-200">monet</SheetTitle>
        </SheetHeader>

        <Separator className="bg-zinc-800" />

        <ScrollArea className="h-[calc(100vh-64px)]">
          <div className="px-5 py-4 space-y-6">

            {/* Agents */}
            <section>
              <SectionLabel label="Agents" />
              <div className="space-y-1 divide-y divide-zinc-800/60">
                {agents.map((agent) => (
                  <AgentRow key={agent.id} agent={agent} />
                ))}
              </div>
            </section>

            {/* Connections */}
            <section>
              <SectionLabel label="Connections" />
              <div className="space-y-0.5">
                {connections.map((conn) => (
                  <ConnectionRow key={conn.id} connection={conn} />
                ))}
              </div>
            </section>

            {/* Activity */}
            <section>
              <SectionLabel label="Recent Activity" />
              <div className="mt-1">
                {recentActivity.map((event, i) => (
                  <ActivityItem
                    key={event.id}
                    event={event}
                    showLine={i < recentActivity.length - 1}
                  />
                ))}
              </div>
            </section>

          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
