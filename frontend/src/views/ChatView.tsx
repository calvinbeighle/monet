/**
 * views/ChatView.tsx
 * Placeholder chat interface view.
 * Shown when activeView is 'chat'.
 */
import { ArrowLeft, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/appStore';

/**
 * Chat view placeholder with back button.
 */
export function ChatView() {
  const { setActiveView } = useAppStore();

  return (
    <div className="flex flex-col w-full h-full">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800/60">
        <Button
          variant="ghost"
          size="icon"
          className="w-7 h-7 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
          onClick={() => setActiveView('home')}
        >
          <ArrowLeft size={15} strokeWidth={1.5} />
        </Button>
        <h2 className="text-sm font-medium text-zinc-200">Chat</h2>
      </div>

      <div className="flex flex-col items-center justify-center flex-1 gap-4">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-zinc-800">
          <MessageCircle size={20} strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
        </div>
        <p className="text-sm text-zinc-500">Chat interface - coming soon</p>
      </div>
    </div>
  );
}
