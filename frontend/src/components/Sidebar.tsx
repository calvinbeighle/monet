/**
 * components/Sidebar.tsx
 * Left sidebar panel containing agents, connections, and history sections.
 * Collapsible via the sidebarOpen state in the global store.
 */
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../stores/appStore';
import { AgentPill } from './AgentPill';
import { ConnectionRow } from './ConnectionRow';

/**
 * Groups history items by their date label.
 */
function groupByDate<T extends { date: string }>(items: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    if (!groups.has(item.date)) groups.set(item.date, []);
    groups.get(item.date)!.push(item);
  }
  return groups;
}

/** Section header label style */
function SectionLabel({ label }: { label: string }) {
  return (
    <div
      className="px-3 py-1.5 mt-4 mb-1"
      style={{ color: 'var(--text-muted)', fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}
    >
      {label}
    </div>
  );
}

/**
 * The full sidebar component. Animates width on collapse.
 */
export function Sidebar() {
  const { sidebarOpen, agents, connections, history } = useAppStore();
  const historyGroups = groupByDate(history);

  return (
    <AnimatePresence initial={false}>
      {sidebarOpen && (
        <motion.aside
          key="sidebar"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 280, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="flex flex-col flex-shrink-0 h-full overflow-hidden"
          style={{
            background: 'var(--surface)',
            borderRight: '1px solid var(--border)',
          }}
        >
          {/* Inner scrollable content - pushed down to account for TopBar */}
          <div className="flex flex-col flex-1 overflow-y-auto pt-12 pb-4">

            {/* AGENTS section */}
            <SectionLabel label="Agents" />
            <div className="px-1">
              {agents.map((agent) => (
                <AgentPill key={agent.id} agent={agent} />
              ))}
            </div>

            {/* CONNECTIONS section */}
            <SectionLabel label="Connections" />
            <div className="px-1">
              {connections.map((conn) => (
                <ConnectionRow key={conn.id} connection={conn} />
              ))}
            </div>

            {/* HISTORY section */}
            <SectionLabel label="History" />
            <div className="px-1">
              {Array.from(historyGroups.entries()).map(([date, items]) => (
                <div key={date}>
                  <div
                    className="px-3 py-1"
                    style={{ color: 'var(--text-muted)', fontSize: '10px', fontWeight: 500 }}
                  >
                    {date}
                  </div>
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-all duration-150"
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-elevated)';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                      }}
                    >
                      <span
                        className="flex-1 truncate"
                        style={{ color: 'var(--text-secondary)', fontSize: '12px' }}
                      >
                        {item.title}
                      </span>
                      <span
                        style={{ color: 'var(--text-muted)', fontSize: '10px', flexShrink: 0 }}
                      >
                        {item.timestamp}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
