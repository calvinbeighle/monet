/**
 * components/SuggestionCard.tsx
 * A single clickable suggestion item displayed below the command bar.
 * Shows a colored icon, title, and description. Clicking fires onSelect.
 */
import type { Suggestion } from '../types';

interface SuggestionCardProps {
  suggestion: Suggestion;
  isLast: boolean;
  onSelect: (suggestion: Suggestion) => void;
}

/** Short abbreviation shown inside the icon circle */
function getIconLabel(icon: string): string {
  const labels: Record<string, string> = {
    gmail: 'G',
    github: 'GH',
    calendar: 'C',
    notion: 'N',
  };
  return labels[icon] ?? icon[0]?.toUpperCase() ?? '?';
}

/**
 * Renders a suggestion card row. Non-last cards have a bottom divider.
 * Lifts slightly on hover for a tactile feel.
 */
export function SuggestionCard({ suggestion, isLast, onSelect }: SuggestionCardProps) {
  return (
    <>
      <button
        onClick={() => onSelect(suggestion)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-all duration-150 cursor-pointer"
        style={{ background: 'transparent' }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.03)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        }}
      >
        {/* Icon circle */}
        <span
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-semibold"
          style={{
            background: suggestion.iconColor + '22',
            color: suggestion.iconColor,
            fontSize: '10px',
            fontWeight: 700,
            letterSpacing: '0.02em',
          }}
        >
          {getIconLabel(suggestion.icon)}
        </span>

        {/* Text content */}
        <div className="flex-1 min-w-0">
          <div
            className="truncate"
            style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 400 }}
          >
            {suggestion.title}
          </div>
          <div
            className="truncate mt-0.5"
            style={{ color: 'var(--text-muted)', fontSize: '11px' }}
          >
            {suggestion.description}
          </div>
        </div>

        {/* Arrow hint */}
        <span style={{ color: 'var(--text-muted)', fontSize: '12px', flexShrink: 0 }}>
          &rarr;
        </span>
      </button>

      {/* Divider between cards */}
      {!isLast && (
        <div
          className="mx-4"
          style={{ height: '1px', background: 'var(--border)' }}
        />
      )}
    </>
  );
}
