// Map viewport - connects PixiJS renderer with React and Zustand state
// Per Spec 02: WebGL-backed 2D renderer for 500+ entity performance
// Per Spec 08: Pan/zoom navigation with cursor-anchored zoom

import { useRef, useEffect, useCallback } from "react";
import { MapRenderer } from "./map-renderer";
import { createZoneLayout, updateZoneSizes } from "./zone-layout";
import { driftTick } from "./drift-engine";
import { useThreadStore } from "../../lib/stores";
import type { ZoneId } from "../../lib/types";

// Drift tick interval in ms (fires independently of render per Spec 10)
const DRIFT_TICK_INTERVAL = 200;

export function MapViewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const zonesRef = useRef(createZoneLayout());
  const driftIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  const threads = useThreadStore((s) => s.threads);
  // Initialize PixiJS renderer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new MapRenderer();
    rendererRef.current = renderer;

    let destroyed = false;
    const init = async () => {
      try {
        await renderer.init({
          container,
          width: container.clientWidth || 800,
          height: container.clientHeight || 600,
        });
        if (!destroyed) {
          renderer.renderZones(zonesRef.current);
        }
      } catch {
        // PixiJS init fails in non-browser environments (jsdom) - graceful fallback
        console.warn("[MapViewport] PixiJS init failed, running without renderer");
      }
    };

    init();

    return () => {
      destroyed = true;
      try {
        renderer.destroy();
      } catch {
        // Cleanup may fail in test environment
      }
      rendererRef.current = null;
    };
  }, []);

  // Handle resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        rendererRef.current?.resize(width, height);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Drift engine tick - runs independently of rendering per Spec 10
  useEffect(() => {
    driftIntervalRef.current = setInterval(() => {
      const threadArray = [...useThreadStore.getState().threads.values()];
      if (threadArray.length === 0) return;

      const now = Date.now();
      const updated = driftTick(threadArray, zonesRef.current, now);

      // Update zone sizes based on thread distribution
      const counts: Record<ZoneId, number> = {
        "active-front": 0,
        opportunities: 0,
        "at-risk": 0,
        lost: 0,
        noise: 0,
        "base-handled": 0,
      };
      for (const t of updated) {
        counts[t.zone]++;
      }
      updateZoneSizes(zonesRef.current, counts);

      useThreadStore.getState().setThreads(updated);
    }, DRIFT_TICK_INTERVAL);

    return () => {
      if (driftIntervalRef.current) {
        clearInterval(driftIntervalRef.current);
      }
    };
  }, []);

  // Re-render when threads change
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const threadArray = [...threads.values()];
    renderer.renderZones(zonesRef.current);
    renderer.renderThreads(threadArray);
  }, [threads]);

  // Mouse event handlers for pan/zoom (Spec 08)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = true;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - lastMouseRef.current.x;
    const dy = e.clientY - lastMouseRef.current.y;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    rendererRef.current?.pan(-dx, -dy);
  }, []);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const anchorX = e.clientX - rect.left;
    const anchorY = e.clientY - rect.top;
    rendererRef.current?.zoom(factor, anchorX, anchorY);
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-full w-full cursor-grab active:cursor-grabbing"
      data-testid="map-viewport"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    />
  );
}
