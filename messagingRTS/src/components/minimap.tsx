// Minimap per Spec 08
// Always visible, fixed bottom-right corner of map viewport.
// Shows scaled-down map with zone regions, thread positions, and viewport indicator.
// Click to pan main map; drag to pan in real time.

import { useRef, useEffect, useCallback } from "react";
import type { Thread, Zone, ZoneId } from "../lib/types";

// Map dimensions (must match zone-layout.ts canvas)
const MAP_WIDTH = 4000;
const MAP_HEIGHT = 3000;
const MINIMAP_WIDTH = 180;
const MINIMAP_HEIGHT = 135;

interface MinimapProps {
  threads: Thread[];
  zones: Map<ZoneId, Zone>;
  cameraX: number;
  cameraY: number;
  cameraZoom: number;
  viewportWidth: number;
  viewportHeight: number;
  onNavigate: (mapX: number, mapY: number) => void;
}

export function Minimap({
  threads,
  zones,
  cameraX,
  cameraY,
  cameraZoom,
  viewportWidth,
  viewportHeight,
  onNavigate,
}: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingRef = useRef(false);

  const scaleX = MINIMAP_WIDTH / MAP_WIDTH;
  const scaleY = MINIMAP_HEIGHT / MAP_HEIGHT;

  const toMinimapCoord = useCallback(
    (mapX: number, mapY: number) => ({
      x: mapX * scaleX,
      y: mapY * scaleY,
    }),
    [scaleX, scaleY],
  );

  const toMapCoord = useCallback(
    (minimapX: number, minimapY: number) => ({
      x: minimapX / scaleX,
      y: minimapY / scaleY,
    }),
    [scaleX, scaleY],
  );

  // Draw minimap
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT);

    // Background
    ctx.fillStyle = "rgba(10, 10, 18, 0.8)";
    ctx.fillRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT);

    // Zone regions
    for (const [, zone] of zones) {
      const b = zone.boundary;
      const topLeft = toMinimapCoord(b.minX, b.minY);
      const size = {
        w: (b.maxX - b.minX) * scaleX,
        h: (b.maxY - b.minY) * scaleY,
      };

      // Convert hex color to CSS
      const r = (zone.colorTint >> 16) & 0xff;
      const g = (zone.colorTint >> 8) & 0xff;
      const bl = zone.colorTint & 0xff;
      ctx.fillStyle = `rgba(${r}, ${g}, ${bl}, 0.2)`;
      ctx.fillRect(topLeft.x, topLeft.y, size.w, size.h);
    }

    // Thread positions
    for (const thread of threads) {
      const pos = toMinimapCoord(thread.position.x, thread.position.y);
      ctx.fillStyle =
        thread.urgencyScore > 0.5 ? "rgba(221, 51, 51, 0.8)" : "rgba(102, 170, 68, 0.8)";
      ctx.fillRect(pos.x - 1, pos.y - 1, 2, 2);
    }

    // Viewport indicator rectangle
    const vpWidthInMap = viewportWidth / cameraZoom;
    const vpHeightInMap = viewportHeight / cameraZoom;
    const vpLeft = cameraX - vpWidthInMap / 2;
    const vpTop = cameraY - vpHeightInMap / 2;
    const vpMinimap = toMinimapCoord(vpLeft, vpTop);
    const vpSize = {
      w: vpWidthInMap * scaleX,
      h: vpHeightInMap * scaleY,
    };

    ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
    ctx.lineWidth = 1;
    ctx.strokeRect(vpMinimap.x, vpMinimap.y, vpSize.w, vpSize.h);
  }, [
    threads,
    zones,
    cameraX,
    cameraY,
    cameraZoom,
    viewportWidth,
    viewportHeight,
    toMinimapCoord,
    scaleX,
    scaleY,
  ]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const mapPos = toMapCoord(mx, my);
      onNavigate(mapPos.x, mapPos.y);
    },
    [toMapCoord, onNavigate],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      isDraggingRef.current = true;
      handleClick(e);
    },
    [handleClick],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDraggingRef.current) return;
      handleClick(e);
    },
    [handleClick],
  );

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={MINIMAP_WIDTH}
      height={MINIMAP_HEIGHT}
      data-testid="minimap"
      className="absolute bottom-2 right-2 border border-white/20 rounded cursor-crosshair"
      style={{ zIndex: 10 }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleClick}
    />
  );
}
