/**
 * components/DecisionCard.tsx
 * Renders a single pending decision as a shadcn Card.
 * Features a colored left border accent, priority badge, and action buttons.
 */
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Decision } from '@/types';

interface DecisionCardProps {
  decision: Decision;
}

/**
 * Card for a pending decision in the Monitor view.
 * Shows colored left border, title, summary, priority badge,
 * a primary action button, and a Skip button.
 */
export function DecisionCard({ decision }: DecisionCardProps) {
  return (
    <Card
      className="bg-zinc-900 border-zinc-800 overflow-hidden"
      style={{
        borderLeft: `3px solid ${decision.accentColor}`,
      }}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="text-sm font-medium text-zinc-100 leading-snug">{decision.title}</h3>
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 shrink-0 ${
              decision.priority === 'urgent'
                ? 'border-red-500/40 text-red-400 bg-red-500/10'
                : 'border-zinc-700 text-zinc-500'
            }`}
          >
            {decision.priority}
          </Badge>
        </div>

        <p className="text-xs text-zinc-500 mb-4 leading-relaxed">{decision.summary}</p>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-7 text-xs px-3 bg-zinc-100 text-zinc-900 hover:bg-white"
          >
            {decision.primaryAction}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs px-3 text-zinc-500 hover:text-zinc-300"
          >
            Skip
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
