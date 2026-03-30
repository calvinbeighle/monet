/**
 * views/DiffView.tsx
 * Placeholder code diff / PR review view.
 * Shown when activeView is 'diff'.
 */
import { ArrowLeft, GitCompare } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';

/**
 * Diff view placeholder with clean back button and centered placeholder text.
 */
export function DiffView() {
  const { setActiveView } = useAppStore();

  return (
    <div className="flex flex-col w-full h-full bg-zinc-950">
      {/* Back navigation */}
      <div className="p-8">
        <button
          onClick={() => setActiveView('home')}
          className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 transition-colors duration-150 text-[14px]"
        >
          <ArrowLeft size={15} strokeWidth={1.5} />
          Back
        </button>
      </div>

      {/* Centered placeholder */}
      <div className="flex flex-col items-center justify-center flex-1 gap-3">
        <GitCompare size={20} strokeWidth={1.5} className="text-violet-500" />
        <p className="text-zinc-600" style={{ fontSize: '16px' }}>Diff viewer - coming soon</p>
      </div>
    </div>
  );
}
