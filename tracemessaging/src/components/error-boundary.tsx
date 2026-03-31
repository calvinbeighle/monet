import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean; error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4">
          <p className="font-mono text-[0.9rem] text-[rgba(255,107,107,0.8)]">
            Something went wrong
          </p>
          <p className="max-w-md text-center font-mono text-[0.75rem] text-[rgba(255,255,255,0.3)]">
            {this.state.error?.message}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="cursor-pointer rounded-md border border-[rgba(255,255,255,0.12)] bg-[#111113] px-4 py-2 font-mono text-[0.75rem] text-[rgba(255,255,255,0.55)] transition-all hover:border-[rgba(255,255,255,0.2)]"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
