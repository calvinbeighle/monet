// Map viewport - connects PixiJS renderer with React and Zustand state
// Per Spec 02: WebGL-backed 2D renderer for 500+ entity performance
// Per Spec 08: Full navigation system - pan, zoom, selection, search, keyboard, minimap

import { useRef, useEffect, useCallback, useState } from "react";
import { MapRenderer } from "./map-renderer";
import { createZoneLayout, updateZoneSizes } from "./zone-layout";
import { driftTick } from "./drift-engine";
import { useThreadStore, useAppStore } from "../../lib/stores";
import { useNavigationStore } from "../navigation/navigation-store";
import {
  searchThreads,
  findNextThreadInDirection,
  findNearestThread,
  computeEdgeScroll,
  hitTestThread,
  screenToMap,
  computeThreadCentroid,
  zoomToFitZone,
  getCanonicalZoom,
  ZONE_SHORTCUTS,
} from "../navigation/navigation-system";
import { Minimap } from "../../components/minimap";
import { SearchOverlay } from "../../components/search-overlay";
import type { ZoneId } from "../../lib/types";

// Drift tick interval in ms (fires independently of render per Spec 10)
const DRIFT_TICK_INTERVAL = 200;
// Camera sync interval for React state
const CAMERA_SYNC_INTERVAL = 100;
// Double-click detection window
const DOUBLE_CLICK_MS = 300;

export function MapViewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const zonesRef = useRef(createZoneLayout());
  const driftIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cameraSyncRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const edgeScrollRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const isDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const lastClickTimeRef = useRef(0);
  const lastClickIdRef = useRef<string | null>(null);
  const dragDistanceRef = useRef(0);

  const threads = useThreadStore((s) => s.threads);
  const selectedThreadId = useThreadStore((s) => s.selectedThreadId);
  const selectThread = useThreadStore((s) => s.selectThread);

  const camera = useNavigationStore((s) => s.camera);
  const searchActive = useNavigationStore((s) => s.searchActive);
  const searchResults = useNavigationStore((s) => s.searchResults);
  const searchFocusIndex = useNavigationStore((s) => s.searchFocusIndex);

  const viewportWidth = useAppStore((s) => s.viewportWidth);
  const viewportHeight = useAppStore((s) => s.viewportHeight);

  // Zone snapshot for render - updated from the ref by the drift tick
  const [zonesSnapshot, setZonesSnapshot] = useState(createZoneLayout);

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

          // Initial camera: center on thread centroid per Spec 08
          const threadArray = [...useThreadStore.getState().threads.values()];
          const centroid = computeThreadCentroid(threadArray);
          renderer.setCamera(centroid.x, centroid.y, 0.5); // Strategic overview

          // Sync initial camera state
          const camState = renderer.getCameraState();
          useNavigationStore.getState().syncCamera(camState);
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

  // Handle resize - sync to app store for minimap and responsive layout
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        rendererRef.current?.resize(width, height);
        useAppStore.getState().setViewportDimensions(width, height);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Camera sync interval - mirrors renderer camera state into navigation store
  useEffect(() => {
    cameraSyncRef.current = setInterval(() => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      const camState = renderer.getCameraState();
      useNavigationStore.getState().syncCamera(camState);
    }, CAMERA_SYNC_INTERVAL);

    return () => {
      if (cameraSyncRef.current) clearInterval(cameraSyncRef.current);
    };
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
      setZonesSnapshot(new Map(zonesRef.current));

      useThreadStore.getState().setThreads(updated);
    }, DRIFT_TICK_INTERVAL);

    return () => {
      if (driftIntervalRef.current) {
        clearInterval(driftIntervalRef.current);
      }
    };
  }, []);

  // Re-render when threads or selection changes
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const threadArray = [...threads.values()];
    renderer.setSelectedThread(selectedThreadId);
    renderer.renderZones(zonesRef.current);
    renderer.renderThreads(threadArray);
  }, [threads, selectedThreadId]);

  // Sync search highlighting to renderer
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setSearchHighlight(searchResults, searchActive);
  }, [searchResults, searchActive]);

  // Pan camera to focused search result per Spec 08
  useEffect(() => {
    if (!searchActive || searchResults.length === 0 || searchFocusIndex < 0) return;
    const focusedId = searchResults[searchFocusIndex];
    const thread = useThreadStore.getState().threads.get(focusedId);
    if (!thread) return;

    const renderer = rendererRef.current;
    if (!renderer) return;

    // Pan to the focused thread; zoom to operational if below it
    const cam = renderer.getCameraState();
    const targetZoom = cam.zoom < 0.6 ? 0.85 : cam.zoom; // at least operational per Spec 08
    renderer.animateTo(thread.position.x, thread.position.y, targetZoom);
  }, [searchActive, searchResults, searchFocusIndex]);

  // -- Mouse event handlers --

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = true;
    dragDistanceRef.current = 0;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - lastMouseRef.current.x;
    const dy = e.clientY - lastMouseRef.current.y;
    dragDistanceRef.current += Math.abs(dx) + Math.abs(dy);
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    rendererRef.current?.pan(-dx, -dy);

    // Edge scrolling per Spec 08 (only during drag)
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const edgeDir = computeEdgeScroll(localX, localY, rect.width, rect.height);
    useNavigationStore.getState().setEdgeScrollDirection(edgeDir);
  }, []);

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const wasDragging = dragDistanceRef.current > 5;
      isDraggingRef.current = false;
      useNavigationStore.getState().setEdgeScrollDirection(null);

      if (wasDragging) return; // It was a drag, not a click

      // Click handling per Spec 08
      const renderer = rendererRef.current;
      const container = containerRef.current;
      if (!renderer || !container) return;

      const rect = container.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const cam = renderer.getCameraState();
      const mapPos = screenToMap(screenX, screenY, cam, rect.width, rect.height);

      const threadArray = [...useThreadStore.getState().threads.values()];
      const hitId = hitTestThread(threadArray, mapPos.x, mapPos.y);

      const now = Date.now();
      const isDoubleClick =
        now - lastClickTimeRef.current < DOUBLE_CLICK_MS && lastClickIdRef.current === hitId;
      lastClickTimeRef.current = now;
      lastClickIdRef.current = hitId;

      if (isDoubleClick && hitId) {
        // Double-click: zoom to detail per Spec 08
        const thread = useThreadStore.getState().threads.get(hitId);
        if (thread) {
          useNavigationStore.getState().saveCameraHistory();
          selectThread(hitId);
          useNavigationStore.getState().openDetailPanel();
          renderer.animateTo(thread.position.x, thread.position.y, getCanonicalZoom("detail"));
        }
        return;
      }

      if (hitId) {
        const zoomLevel = cam.level;
        if (zoomLevel === "strategic") {
          // At strategic zoom, click cluster dot -> zoom to tactical per Spec 08
          const thread = useThreadStore.getState().threads.get(hitId);
          if (thread) {
            useNavigationStore.getState().saveCameraHistory();
            renderer.animateTo(thread.position.x, thread.position.y, getCanonicalZoom("tactical"));
          }
        } else {
          // Single click -> select per Spec 08
          selectThread(hitId);
          useNavigationStore.getState().openDetailPanel();
        }
      } else {
        // Click empty space -> clear selection per Spec 08
        selectThread(null);
        useNavigationStore.getState().closeDetailPanel();
      }
    },
    [selectThread],
  );

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const renderer = rendererRef.current;
    if (!renderer) return;

    // Save history when crossing zoom level boundaries
    const prevLevel = renderer.getCameraState().level;
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const anchorX = e.clientX - rect.left;
    const anchorY = e.clientY - rect.top;
    renderer.zoom(factor, anchorX, anchorY);

    const newLevel = renderer.getCameraState().level;
    if (newLevel !== prevLevel) {
      useNavigationStore.getState().saveCameraHistory();
    }
  }, []);

  // -- Keyboard handlers --

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const renderer = rendererRef.current;
      if (!renderer) return;

      // Don't handle keys when search overlay is active (it manages its own keys)
      if (useNavigationStore.getState().searchActive) return;

      // Search activation: Ctrl+F or / per Spec 08
      if ((e.ctrlKey && e.key === "f") || (e.key === "/" && !e.ctrlKey)) {
        e.preventDefault();
        useNavigationStore.getState().openSearch();
        return;
      }

      // Escape - back navigation per Spec 08
      if (e.key === "Escape") {
        e.preventDefault();
        const navStore = useNavigationStore.getState();
        const currentSelection = useThreadStore.getState().selectedThreadId;

        if (navStore.detailPanelOpen) {
          // First escape: close detail panel, clear selection
          selectThread(null);
          navStore.closeDetailPanel();
        } else if (currentSelection) {
          // Clear selection
          selectThread(null);
        } else {
          // Back navigation
          const prev = navStore.restorePreviousCamera();
          if (prev) {
            renderer.animateTo(prev.x, prev.y, prev.zoom);
          }
        }
        return;
      }

      // Arrow key navigation per Spec 08
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const cam = renderer.getCameraState();
        const threadArray = [...useThreadStore.getState().threads.values()];
        const currentId = useThreadStore.getState().selectedThreadId;

        // If nothing selected, select nearest to viewport center
        if (!currentId) {
          const nearest = findNearestThread(threadArray, cam.x, cam.y);
          if (nearest) {
            selectThread(nearest);
            useNavigationStore.getState().openDetailPanel();
            // Pan to keep visible
            const thread = useThreadStore.getState().threads.get(nearest);
            if (thread) {
              renderer.animateTo(thread.position.x, thread.position.y, cam.zoom);
            }
          }
          return;
        }

        const nextId = findNextThreadInDirection(threadArray, currentId, e.key, cam.level);
        if (nextId) {
          selectThread(nextId);
          // Pan to keep selected entity visible per Spec 08
          const thread = useThreadStore.getState().threads.get(nextId);
          if (thread) {
            renderer.animateTo(thread.position.x, thread.position.y, cam.zoom);
          }
        }
        return;
      }

      // Tab - cycle through zone labels per Spec 08
      if (e.key === "Tab") {
        e.preventDefault();
        // Tab cycling through zone quick-nav labels handled at shell level
        return;
      }

      // Enter on selected thread -> zoom to detail per Spec 08
      if (e.key === "Enter" && selectedThreadId) {
        e.preventDefault();
        const thread = useThreadStore.getState().threads.get(selectedThreadId);
        if (thread) {
          useNavigationStore.getState().saveCameraHistory();
          useNavigationStore.getState().openDetailPanel();
          renderer.animateTo(thread.position.x, thread.position.y, getCanonicalZoom("detail"));
        }
        return;
      }

      // Zone quick-nav shortcuts (1-6) per Spec 08
      const zoneId = ZONE_SHORTCUTS[e.key];
      if (zoneId) {
        e.preventDefault();
        const zone = zonesRef.current.get(zoneId);
        if (zone) {
          const container = containerRef.current;
          const vw = container?.clientWidth ?? 800;
          const vh = container?.clientHeight ?? 600;
          const fit = zoomToFitZone(zone, vw, vh);
          useNavigationStore.getState().saveCameraHistory();
          renderer.animateTo(fit.centerX, fit.centerY, fit.zoom);
        }
        return;
      }
    },
    [selectThread, selectedThreadId],
  );

  // Edge scroll animation loop
  useEffect(() => {
    let running = true;
    const tick = () => {
      if (!running) return;
      const dir = useNavigationStore.getState().edgeScrollDirection;
      if (dir && isDraggingRef.current) {
        rendererRef.current?.pan(dir.x, dir.y);
      }
      edgeScrollRef.current = requestAnimationFrame(tick);
    };
    edgeScrollRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      if (edgeScrollRef.current) cancelAnimationFrame(edgeScrollRef.current);
    };
  }, []);

  // -- Search handlers --

  const handleSearch = useCallback((query: string) => {
    const navStore = useNavigationStore.getState();
    navStore.setSearchQuery(query);

    const threadArray = [...useThreadStore.getState().threads.values()];
    const results = searchThreads(threadArray, query);
    navStore.setSearchResults(results);
  }, []);

  const handleSearchCycleNext = useCallback(() => {
    useNavigationStore.getState().focusNextResult();
  }, []);

  const handleSearchCyclePrev = useCallback(() => {
    useNavigationStore.getState().focusPreviousResult();
  }, []);

  const handleSearchClose = useCallback(() => {
    useNavigationStore.getState().closeSearch();
    // Return focus to map per Spec 12
    containerRef.current?.focus();
  }, []);

  // -- Minimap navigation --

  const handleMinimapNavigate = useCallback((mapX: number, mapY: number) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    // Pan to clicked location; zoom does not change per Spec 08
    const cam = renderer.getCameraState();
    renderer.animateTo(mapX, mapY, cam.zoom);
  }, []);

  const threadArray = [...threads.values()];

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full cursor-grab active:cursor-grabbing outline-none"
      data-testid="map-viewport"
      tabIndex={0}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
    >
      <SearchOverlay
        onSearch={handleSearch}
        onCycleNext={handleSearchCycleNext}
        onCyclePrevious={handleSearchCyclePrev}
        onClose={handleSearchClose}
      />
      <Minimap
        threads={threadArray}
        zones={zonesSnapshot}
        cameraX={camera.x}
        cameraY={camera.y}
        cameraZoom={camera.zoom}
        viewportWidth={viewportWidth || 800}
        viewportHeight={viewportHeight || 600}
        onNavigate={handleMinimapNavigate}
      />
    </div>
  );
}
