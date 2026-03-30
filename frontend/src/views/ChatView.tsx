/**
 * views/ChatView.tsx
 * Placeholder chat interface view.
 * Shown when activeView is 'chat'.
 */
import { ArrowLeft, MessageCircle } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';

/**
 * Chat view placeholder with clean back button and centered placeholder text.
 */
export function ChatView() {
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
        <MessageCircle size={20} strokeWidth={1.5} className="text-violet-500" />
        <p className="text-zinc-600" style={{ fontSize: '16px' }}>Chat interface - coming soon</p>
      </div>
    </div>
  );
}
