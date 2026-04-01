// Filter panel per Spec 09 - thread visibility filtering
// Accessible from status bar, shows zone/label/sender/urgency filters
// Filter store already handles persistence and escape hatch for at-risk/lost threads

import { useFilterStore } from "../lib/stores/filter-store";
import type { ZoneId } from "../lib/types";

const ZONE_LABELS: Record<ZoneId, string> = {
  "active-front": "Active Front",
  opportunities: "Opportunities",
  "at-risk": "At Risk",
  lost: "Lost",
  noise: "Noise",
  "base-handled": "Handled",
};

const ALL_ZONES: ZoneId[] = [
  "active-front",
  "opportunities",
  "at-risk",
  "lost",
  "noise",
  "base-handled",
];

interface FilterPanelProps {
  onClose: () => void;
}

export function FilterPanel({ onClose }: FilterPanelProps) {
  const filter = useFilterStore((s) => s.filter);
  const toggleZoneFilter = useFilterStore((s) => s.toggleZoneFilter);
  const toggleLabelFilter = useFilterStore((s) => s.toggleLabelFilter);
  const setSenderFilter = useFilterStore((s) => s.setSenderFilter);
  const setUrgencyRange = useFilterStore((s) => s.setUrgencyRange);
  const clearAllFilters = useFilterStore((s) => s.clearAllFilters);
  const isActive = useFilterStore((s) => s.isFilterActive);

  const handleSenderInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const val = e.currentTarget.value.trim();
    if (!val) return;
    const current = filter.senders;
    if (!current.includes(val)) {
      setSenderFilter([...current, val]);
    }
    e.currentTarget.value = "";
  };

  const removeSender = (sender: string) => {
    setSenderFilter(filter.senders.filter((s) => s !== sender));
  };

  const handleLabelInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const val = e.currentTarget.value.trim();
    if (!val) return;
    toggleLabelFilter(val);
    e.currentTarget.value = "";
  };

  return (
    <div
      className="w-72 rounded-lg border border-gray-700 bg-[#14142a] p-4 shadow-xl"
      data-testid="filter-panel"
      role="dialog"
      aria-label="Thread filters"
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-200">Filters</h3>
        <div className="flex items-center gap-2">
          {isActive() && (
            <button
              className="text-[10px] text-blue-400 hover:text-blue-300"
              onClick={clearAllFilters}
              data-testid="clear-filters"
            >
              Clear all
            </button>
          )}
          <button
            className="text-gray-500 hover:text-gray-300 text-xs"
            onClick={onClose}
            aria-label="Close filters"
            data-testid="close-filter-panel"
          >
            x
          </button>
        </div>
      </div>

      {/* Zone filter */}
      <div className="mb-3">
        <span className="text-[10px] uppercase tracking-wider text-gray-500">Zones</span>
        <div className="mt-1 flex flex-wrap gap-1">
          {ALL_ZONES.map((zone) => {
            const active = filter.zones.length === 0 || filter.zones.includes(zone);
            return (
              <button
                key={zone}
                className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                  active ? "bg-gray-700 text-gray-200" : "bg-gray-800/50 text-gray-600"
                }`}
                onClick={() => toggleZoneFilter(zone)}
                data-testid={`zone-filter-${zone}`}
              >
                {ZONE_LABELS[zone]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Label filter */}
      <div className="mb-3">
        <span className="text-[10px] uppercase tracking-wider text-gray-500">Labels</span>
        <div className="mt-1 flex flex-wrap gap-1">
          {filter.labels.map((label) => (
            <span
              key={label}
              className="flex items-center gap-1 rounded bg-gray-700 px-1.5 py-0.5 text-[10px] text-gray-300"
            >
              {label}
              <button
                className="text-gray-500 hover:text-gray-300"
                onClick={() => toggleLabelFilter(label)}
                aria-label={`Remove ${label} filter`}
              >
                x
              </button>
            </span>
          ))}
        </div>
        <input
          className="mt-1 w-full rounded border border-gray-700 bg-[#0e0e1a] px-2 py-1 text-[10px] text-gray-300 placeholder-gray-600 outline-none focus:border-gray-500"
          placeholder="Add label (Enter)"
          onKeyDown={handleLabelInput}
          data-testid="label-filter-input"
        />
      </div>

      {/* Sender filter */}
      <div className="mb-3">
        <span className="text-[10px] uppercase tracking-wider text-gray-500">
          Senders / Domains
        </span>
        <div className="mt-1 flex flex-wrap gap-1">
          {filter.senders.map((sender) => (
            <span
              key={sender}
              className="flex items-center gap-1 rounded bg-gray-700 px-1.5 py-0.5 text-[10px] text-gray-300"
            >
              {sender}
              <button
                className="text-gray-500 hover:text-gray-300"
                onClick={() => removeSender(sender)}
                aria-label={`Remove ${sender} filter`}
              >
                x
              </button>
            </span>
          ))}
        </div>
        <input
          className="mt-1 w-full rounded border border-gray-700 bg-[#0e0e1a] px-2 py-1 text-[10px] text-gray-300 placeholder-gray-600 outline-none focus:border-gray-500"
          placeholder="email or @domain (Enter)"
          onKeyDown={handleSenderInput}
          data-testid="sender-filter-input"
        />
      </div>

      {/* Urgency range */}
      <div>
        <span className="text-[10px] uppercase tracking-wider text-gray-500">
          Urgency: {Math.round(filter.urgencyMin * 100)}% - {Math.round(filter.urgencyMax * 100)}%
        </span>
        <div className="mt-1 flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={100}
            value={filter.urgencyMin * 100}
            onChange={(e) => setUrgencyRange(Number(e.target.value) / 100, filter.urgencyMax)}
            className="h-1 flex-1 appearance-none rounded bg-gray-700"
            data-testid="urgency-min-slider"
          />
          <input
            type="range"
            min={0}
            max={100}
            value={filter.urgencyMax * 100}
            onChange={(e) => setUrgencyRange(filter.urgencyMin, Number(e.target.value) / 100)}
            className="h-1 flex-1 appearance-none rounded bg-gray-700"
            data-testid="urgency-max-slider"
          />
        </div>
      </div>

      <p className="mt-3 text-[9px] text-gray-600">
        At-risk and lost threads always surface regardless of filters.
      </p>
    </div>
  );
}
