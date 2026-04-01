// Zone quick-nav label panel per Spec 08
// Persistent compact overlay showing zone names with keyboard shortcuts (1-6)

import { ZONE_DEFINITIONS } from "../lib/types";
import type { ZoneId } from "../lib/types";

// Zone shortcut mapping (matches navigation-system.ts ZONE_SHORTCUTS)
const ZONE_NAV_ITEMS: Array<{ key: string; zoneId: ZoneId }> = [
  { key: "1", zoneId: "active-front" },
  { key: "2", zoneId: "opportunities" },
  { key: "3", zoneId: "at-risk" },
  { key: "4", zoneId: "lost" },
  { key: "5", zoneId: "noise" },
  { key: "6", zoneId: "base-handled" },
];

interface ZoneQuickNavProps {
  onNavigate?: (zoneId: ZoneId) => void;
  focusedZone?: ZoneId | null; // per Spec 08 Section 16: Tab-cycling highlight
}

export function ZoneQuickNav({ onNavigate, focusedZone }: ZoneQuickNavProps) {
  return (
    <div
      className="absolute bottom-4 left-4 z-20 rounded bg-[#0e0e1a]/90 border border-gray-800 px-3 py-2"
      data-testid="zone-quick-nav"
      role="tablist"
      aria-label="Zone navigation"
    >
      <div className="flex flex-col gap-1">
        {ZONE_NAV_ITEMS.map(({ key, zoneId }) => {
          const def = ZONE_DEFINITIONS[zoneId];
          const isFocused = focusedZone === zoneId;
          return (
            <button
              key={zoneId}
              className={`flex items-center gap-2 text-xs transition-colors text-left ${
                isFocused
                  ? "text-white bg-gray-700/60 rounded px-1 -mx-1"
                  : "text-gray-400 hover:text-gray-200"
              }`}
              onClick={() => onNavigate?.(zoneId)}
              data-testid={`zone-nav-${zoneId}`}
              role="tab"
              aria-selected={isFocused}
              tabIndex={isFocused ? 0 : -1}
            >
              <kbd className="inline-flex h-4 w-4 items-center justify-center rounded bg-gray-800 text-[10px] text-gray-500 font-mono">
                {key}
              </kbd>
              <span>{def.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
