/**
 * views/MonitorView.tsx
 * Visual agent dashboard with two tabs: Activity timeline and Decisions queue.
 * Accessed from the Monitor button in the TopBar.
 */
import { ArrowLeft } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ActivityItem } from '@/components/ActivityItem';
import { DecisionCard } from '@/components/DecisionCard';
import { useAppStore } from '@/stores/appStore';

/**
 * MonitorView shows the Activity and Decisions tabs.
 * Back button returns to home view.
 */
export function MonitorView() {
  const { setActiveView, agents, activity, decisions } = useAppStore();

  return (
    <div className="flex flex-col w-full h-full">
      {/* View header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800/60">
        <Button
          variant="ghost"
          size="icon"
          className="w-7 h-7 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
          onClick={() => setActiveView('home')}
        >
          <ArrowLeft size={15} strokeWidth={1.5} />
        </Button>
        <h2 className="text-sm font-medium text-zinc-200">Monitor</h2>
      </div>

      {/* Running agents summary */}
      {agents.filter((a) => a.status === 'running').length > 0 && (
        <div className="px-6 py-3 border-b border-zinc-800/40">
          <div className="flex flex-col gap-2">
            {agents
              .filter((a) => a.status === 'running')
              .map((agent) => (
                <div key={agent.id} className="flex items-center gap-3">
                  <div
                    className="w-1.5 h-1.5 rounded-full animate-pulse"
                    style={{ backgroundColor: '#22c55e' }}
                  />
                  <span className="text-xs text-zinc-400 w-28 shrink-0">{agent.name}</span>
                  <Progress
                    value={agent.progress ?? 50}
                    className="flex-1 h-1 bg-zinc-800"
                  />
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 bg-green-500/10 text-green-400 border-green-500/20 shrink-0"
                  >
                    running
                  </Badge>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="activity" className="flex flex-col flex-1 min-h-0">
        <TabsList className="mx-6 mt-4 mb-2 w-fit bg-zinc-900 border border-zinc-800">
          <TabsTrigger
            value="activity"
            className="text-xs data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100"
          >
            Activity
          </TabsTrigger>
          <TabsTrigger
            value="decisions"
            className="text-xs data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100"
          >
            Decisions
            {decisions.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-violet-600/80 text-[9px] text-violet-100">
                {decisions.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Activity tab */}
        <TabsContent value="activity" className="flex-1 min-h-0 mt-0">
          <ScrollArea className="h-full">
            <div className="px-6 pb-6">
              {activity.length === 0 ? (
                <p className="text-sm text-zinc-600 text-center py-10">No activity yet</p>
              ) : (
                <div className="mt-2">
                  {activity.map((event, i) => (
                    <ActivityItem
                      key={event.id}
                      event={event}
                      showLine={i < activity.length - 1}
                    />
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Decisions tab */}
        <TabsContent value="decisions" className="flex-1 min-h-0 mt-0">
          <ScrollArea className="h-full">
            <div className="px-6 pb-6 space-y-3 mt-2">
              {decisions.length === 0 ? (
                <p className="text-sm text-zinc-600 text-center py-10">No pending decisions</p>
              ) : (
                decisions.map((decision) => (
                  <DecisionCard key={decision.id} decision={decision} />
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
