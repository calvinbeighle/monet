// Map viewport placeholder - PixiJS canvas will be initialized here
// Per Spec 02: WebGL-backed 2D renderer for 500+ entity performance

import { useRef, useEffect } from "react";

export function MapViewport() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // PixiJS initialization will happen here in 2.2
    // For now, render an empty dark canvas area
    const container = containerRef.current;
    if (!container) return;

    const canvas = document.createElement("canvas");
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#0a0a12";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw a subtle grid to indicate the map area
      ctx.strokeStyle = "#1a1a2e";
      ctx.lineWidth = 1;
      const gridSize = 50;
      for (let x = 0; x < canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
    }

    container.appendChild(canvas);
    return () => {
      canvas.remove();
    };
  }, []);

  return <div ref={containerRef} className="h-full w-full" data-testid="map-viewport" />;
}
