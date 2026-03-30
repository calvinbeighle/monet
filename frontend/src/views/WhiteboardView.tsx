/**
 * views/WhiteboardView.tsx
 * Placeholder planning canvas / whiteboard view.
 * Shown when activeView is 'whiteboard'.
 */
import { ArrowLeft, Network } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';

/**
 * Whiteboard view placeholder with clean back button and centered placeholder text.
 */
export function WhiteboardView() {
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
        <Network size={20} strokeWidth={1.5} className="text-zinc-500" />
        <p className="text-zinc-600" style={{ fontSize: '16px' }}>Planning canvas - coming soon</p>
      </div>
    </div>
  );
}
