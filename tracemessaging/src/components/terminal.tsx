// Real terminal component using xterm.js + WebSocket to PTY backend

import { useEffect, useRef, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { getWebSocketUrl, useTerminalStore } from "@/lib/stores/terminal-store";

export function Terminal({ sessionId }: { sessionId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const updateRecentOutput = useTerminalStore((s) => s.updateRecentOutput);
  const updateSessionStatus = useTerminalStore((s) => s.updateSessionStatus);

  const connect = useCallback(() => {
    if (!containerRef.current) return;

    // Create terminal
    const term = new XTerm({
      fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: "bar",
      theme: {
        background: "#000000",
        foreground: "rgba(255, 255, 255, 0.7)",
        cursor: "rgba(255, 255, 255, 0.5)",
        selectionBackground: "rgba(255, 255, 255, 0.15)",
        black: "#000000",
        red: "#b40000",
        green: "#007800",
        yellow: "#b48200",
        blue: "#4a6a8a",
        magenta: "#6a4a6a",
        cyan: "#4a7a6a",
        white: "rgba(255, 255, 255, 0.7)",
        brightBlack: "rgba(255, 255, 255, 0.3)",
        brightRed: "#cc3333",
        brightGreen: "#009900",
        brightYellow: "#ccaa00",
        brightBlue: "#6688aa",
        brightMagenta: "#886688",
        brightCyan: "#66aa88",
        brightWhite: "rgba(255, 255, 255, 0.9)",
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Connect WebSocket
    const wsUrl = getWebSocketUrl(sessionId);
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      // Send initial size
      ws.send(
        JSON.stringify({
          type: "resize",
          cols: term.cols,
          rows: term.rows,
        }),
      );
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const text = new TextDecoder().decode(event.data);
        term.write(new Uint8Array(event.data));
        // Capture recent output for feed preview
        const lines = text.split("\n").filter((l) => l.trim().length > 0);
        for (const line of lines.slice(-3)) {
          updateRecentOutput(sessionId, line.slice(0, 120));
        }
      } else if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "exit") {
            updateSessionStatus(sessionId, "exited", msg.code);
            term.write(
              `\r\n\x1b[2m[Process exited with code ${msg.code}]\x1b[0m\r\n`,
            );
          }
        } catch {
          term.write(event.data);
        }
      }
    };

    ws.onclose = () => {
      term.write("\r\n\x1b[2m[Connection closed]\x1b[0m\r\n");
    };

    ws.onerror = () => {
      term.write("\r\n\x1b[31m[Connection error]\x1b[0m\r\n");
    };

    // Terminal input -> WebSocket
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data));
      }
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "resize",
            cols: term.cols,
            rows: term.rows,
          }),
        );
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
    };
  }, [sessionId, updateRecentOutput, updateSessionStatus]);

  useEffect(() => {
    const cleanup = connect();
    return cleanup;
  }, [connect]);

  // Focus terminal when visible
  useEffect(() => {
    const timer = setTimeout(() => {
      termRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ backgroundColor: "#000000" }}
    />
  );
}
