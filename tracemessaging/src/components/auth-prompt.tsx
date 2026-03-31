import { useAppStore } from "../lib/stores";

export function AuthPrompt() {
  const setAuthState = useAppStore((s) => s.setAuthState);

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-[#0a0a0b]">
      <div className="mb-6 font-serif text-[2.5rem] font-normal tracking-tight text-[rgba(255,255,255,0.92)]">
        trace<span className="text-[#c8f06a]">.</span>
      </div>
      <p className="mb-8 max-w-md text-center font-mono text-[0.85rem] text-[rgba(255,255,255,0.45)]">
        Connect your data sources to organize your work by context, not by app.
      </p>
      <button
        onClick={() => setAuthState("authenticating")}
        className="cursor-pointer rounded-md border border-[rgba(255,255,255,0.12)] bg-[#111113] px-6 py-2.5 font-mono text-[0.8rem] text-[rgba(255,255,255,0.7)] transition-all hover:border-[rgba(255,255,255,0.2)] hover:bg-[#18181b]"
      >
        Connect Gmail to get started
      </button>
    </div>
  );
}
