// Map viewport - connects PixiJS renderer with React and Zustand state
// Per Spec 02: WebGL-backed 2D renderer for 500+ entity performance
// Per Spec 08: Full navigation system - pan, zoom, selection, search, keyboard, minimap

import { useRef, useEffect, useCallback, useState } from "react";
import { MapRenderer } from "./map-renderer";
import { createZoneLayout, updateZoneSizes, evaluateZoneAlerts } from "./zone-layout";
import { driftTick, onManualReclassify, setClusterMigration } from "./drift-engine";
import { evaluateClusters, excludeFromCluster } from "./clustering";
import type { Cluster } from "../../lib/types/cluster";
import {
  useThreadStore,
  useAppStore,
  useAgentStore,
  useDeploymentStore,
  useFilterStore,
} from "../../lib/stores";
import { useSyncStore } from "../../lib/stores/sync-store";
import { getZoneAtPosition } from "./zone-layout";
import { getVisibleThreads } from "../../lib/stores/filter-store";
import { AGENT_DEFINITIONS, type AgentRole } from "../../lib/types";
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
import { evaluateAlerts } from "../game-mechanics/map-alerts";
import { runGameTick, isTrustDecayDue, runTrustDecay } from "../game-mechanics/game-loop";
import { Minimap } from "../../components/minimap";
import { SearchOverlay } from "../../components/search-overlay";
import { ZoneQuickNav } from "../../components/zone-quick-nav";
import type { ZoneId } from "../../lib/types";
import type { BatchTarget } from "../../lib/stores/deployment-store";

// Hit-test clusters by checking distance to centroid (Spec 06 Section 11 batch selection)
function hitTestCluster(
  clusters: Cluster[],
  mapX: number,
  mapY: number,
  hitRadius: number = 80,
): Cluster | null {
  let best: Cluster | null = null;
  let bestDist = Infinity;
  for (const cluster of clusters) {
    const dx = cluster.centroid.x - mapX;
    const dy = cluster.centroid.y - mapY;
    const dist = Math.hypot(dx, dy);
    if (dist < hitRadius && dist < bestDist) {
      best = cluster;
      bestDist = dist;
    }
  }
  return best;
}

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
  const clustersRef = useRef<Cluster[]>([]);
  const cameraSyncRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const edgeScrollRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const isDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const lastClickTimeRef = useRef(0);
  const lastClickIdRef = useRef<string | null>(null);
  const dragDistanceRef = useRef(0);
  // Thread drag state per Spec 04 Section 9 - tracks when user is dragging a specific thread
  const threadDragRef = useRef<{
    threadId: string;
    startX: number;
    startY: number;
    clusterId: string | null;
  } | null>(null);
  // Tab zone cycling state per Spec 08 Section 16
  const tabFocusedZoneRef = useRef<ZoneId | null>(null);

  const threads = useThreadStore((s) => s.threads);
  const selectedThreadId = useThreadStore((s) => s.selectedThreadId);
  const selectedThreadIds = useThreadStore((s) => s.selectedThreadIds);
  const selectThread = useThreadStore((s) => s.selectThread);

  const filter = useFilterStore((s) => s.filter);

  const camera = useNavigationStore((s) => s.camera);
  const searchActive = useNavigationStore((s) => s.searchActive);
  const searchResults = useNavigationStore((s) => s.searchResults);
  const searchFocusIndex = useNavigationStore((s) => s.searchFocusIndex);

  const viewportWidth = useAppStore((s) => s.viewportWidth);
  const viewportHeight = useAppStore((s) => s.viewportHeight);

  // Zone snapshot for render - updated from the ref by the drift tick
  const [zonesSnapshot, setZonesSnapshot] = useState(createZoneLayout);
  // Track whether a thread drag is active for cursor styling
  const [isThreadDragging, setIsThreadDragging] = useState(false);
  // Tab-focused zone for zone label cycling per Spec 08 Section 16
  const [tabFocusedZone, setTabFocusedZone] = useState<ZoneId | null>(null);
  // Agent deployment tooltip per Spec 06 Section 8
  const [agentTooltip, setAgentTooltip] = useState<{
    x: number;
    y: number;
    agentRole: string;
    elapsed: number;
    threadCount: number;
    deploymentId: string;
  } | null>(null);

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
          renderer.setCamera(centroid.x, centroid.y, 0.15); // Strategic overview per Spec 08

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
      const updated = driftTick(threadArray, zonesRef.current, now, clustersRef.current);

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
      // Evaluate zone alerts per Spec 04 Section 7
      evaluateZoneAlerts(zonesRef.current);
      setZonesSnapshot(new Map(zonesRef.current));

      // Record positioning tick timestamp per Spec 10
      useSyncStore.setState({ lastPositioningTick: now });

      // Run game mechanics tick per Spec 07
      const appState = useAppStore.getState();
      const gameResult = runGameTick(
        updated,
        appState.trustRecords,
        appState.sessionStats,
        appState.streakState,
        now,
      );

      // Apply opportunity state updates to threads
      useThreadStore.getState().setThreads(gameResult.updatedThreads);

      // Update front health score
      if (gameResult.frontHealthScore !== null) {
        appState.setFrontHealth(gameResult.frontHealthScore);
      }

      // Update streaks
      if (gameResult.streakState !== null) {
        appState.setStreaks(gameResult.streakState);
      }

      // Update session stats (opportunity missed, lost thread counts)
      if (gameResult.sessionStatsDelta !== null) {
        appState.updateSessionStats(gameResult.sessionStatsDelta);
      }

      // Run trust decay (throttled internally to every 30s)
      if (isTrustDecayDue(now)) {
        const decayed = runTrustDecay(appState.trustRecords, gameResult.updatedThreads, now);
        if (decayed !== appState.trustRecords) {
          appState.setTrustRecords(decayed);
        }
      }

      // Evaluate clusters per Spec 11 - runs alongside drift tick
      const clusterResult = evaluateClusters(gameResult.updatedThreads, clustersRef.current, now);

      // Trigger cluster migration animations per Spec 02 state transitions
      // Threads joining a cluster animate toward the cluster centroid
      for (const [threadId, newClusterId] of clusterResult.threadUpdates) {
        if (newClusterId) {
          const cluster = clusterResult.clusters.find((c) => c.id === newClusterId);
          const thread = gameResult.updatedThreads.find((t) => t.id === threadId);
          if (cluster && thread) {
            setClusterMigration(threadId, cluster.centroid, thread.position, now);
          }
        }
      }

      clustersRef.current = clusterResult.clusters;

      // Evaluate map alerts per Spec 07 - runs alongside drift tick
      const newAlerts = evaluateAlerts(
        gameResult.updatedThreads,
        appState.mapAlerts,
        now,
        appState.streakInboxZero,
      );
      appState.setMapAlerts(newAlerts);

      // Tick agent cooldowns per Spec 05
      useAgentStore.getState().tickCooldowns(now);
    }, DRIFT_TICK_INTERVAL);

    return () => {
      if (driftIntervalRef.current) {
        clearInterval(driftIntervalRef.current);
      }
    };
  }, []);

  // Re-render when threads, selection, batch selection, or filter changes
  // Per Spec 09: filter only affects visibility - drift continues on ALL threads
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const threadArray = [...threads.values()];
    const visibleThreads = getVisibleThreads(threadArray, filter);
    renderer.setSelectedThread(selectedThreadId);
    renderer.setBatchSelectedIds(selectedThreadIds);
    renderer.renderZones(zonesRef.current);
    renderer.renderConnections(visibleThreads, clustersRef.current);
    renderer.renderThreads(visibleThreads);
    renderer.renderClusters(clustersRef.current, visibleThreads);
  }, [threads, selectedThreadId, selectedThreadIds, filter]);

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

    // Hit-test threads to start a thread drag per Spec 04 Section 9
    const renderer = rendererRef.current;
    const container = containerRef.current;
    if (renderer && container) {
      const rect = container.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const cam = renderer.getCameraState();
      const mapPos = screenToMap(screenX, screenY, cam, rect.width, rect.height);
      const threadArray = [...useThreadStore.getState().threads.values()];
      const hitId = hitTestThread(threadArray, mapPos.x, mapPos.y);
      if (hitId) {
        // Find if thread belongs to a cluster
        let clusterId: string | null = null;
        for (const cluster of clustersRef.current) {
          if (cluster.memberThreadIds.includes(hitId)) {
            clusterId = cluster.id;
            break;
          }
        }
        threadDragRef.current = {
          threadId: hitId,
          startX: mapPos.x,
          startY: mapPos.y,
          clusterId,
        };
      }
    }
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // Agent drag target validation per Spec 06 Section 3
      const deployDrag = useDeploymentStore.getState().dragState;
      if (deployDrag) {
        const renderer = rendererRef.current;
        const container = containerRef.current;
        if (renderer && container) {
          const rect = container.getBoundingClientRect();
          const screenX = e.clientX - rect.left;
          const screenY = e.clientY - rect.top;
          const cam = renderer.getCameraState();
          const mapPos = screenToMap(screenX, screenY, cam, rect.width, rect.height);
          const hitCluster = hitTestCluster(
            clustersRef.current,
            mapPos.x,
            mapPos.y,
            120 / cam.zoom,
          );
          const hoverClusterId = hitCluster?.id ?? null;
          const zoneId = getZoneAtPosition(zonesRef.current, mapPos.x, mapPos.y);
          const valid = hoverClusterId !== null;
          useDeploymentStore.getState().setDragTarget(hoverClusterId, zoneId, valid);

          // Compute cluster validation sets for renderer visual feedback
          const validClusterIds = new Set<string>();
          const invalidClusterIds = new Set<string>();
          const alreadyDeployedClusterIds = new Set<string>();
          const canDeploy = useAgentStore.getState().canDeployRole(deployDrag.draggingRole);
          const deployments = useDeploymentStore.getState().deployments;

          for (const cluster of clustersRef.current) {
            const hasDeployment = deployments.some(
              (d) =>
                d.agentRole === deployDrag.draggingRole &&
                d.clusterId === cluster.id &&
                (d.status === "in-progress" || d.status === "traveling"),
            );
            if (hasDeployment) {
              alreadyDeployedClusterIds.add(cluster.id);
            } else if (canDeploy) {
              validClusterIds.add(cluster.id);
            } else {
              invalidClusterIds.add(cluster.id);
            }
          }

          renderer.setAgentDragState({
            active: true,
            validClusterIds,
            invalidClusterIds,
            alreadyDeployedClusterIds,
            hoverClusterId,
          });
        }
      }

      if (!isDraggingRef.current) {
        // Agent tooltip detection per Spec 06 Section 8
        if (!deployDrag) {
          const renderer = rendererRef.current;
          const container = containerRef.current;
          if (renderer && container) {
            const rect = container.getBoundingClientRect();
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;
            const cam = renderer.getCameraState();
            const mapPos = screenToMap(screenX, screenY, cam, rect.width, rect.height);
            const hitCluster = hitTestCluster(
              clustersRef.current,
              mapPos.x,
              mapPos.y,
              80 / cam.zoom,
            );

            if (hitCluster) {
              const deployments = useDeploymentStore.getState().deployments;
              const activeDeploy = deployments.find(
                (d) =>
                  d.clusterId === hitCluster.id &&
                  (d.status === "in-progress" || d.status === "traveling"),
              );
              if (activeDeploy) {
                setAgentTooltip({
                  x: e.clientX,
                  y: e.clientY,
                  agentRole: activeDeploy.agentRole,
                  elapsed: Date.now() - activeDeploy.startedAt,
                  threadCount: activeDeploy.threadIds.length,
                  deploymentId: activeDeploy.id,
                });
              } else {
                setAgentTooltip(null);
              }
            } else {
              setAgentTooltip(null);
            }
          }
        }
        return;
      }
      const dx = e.clientX - lastMouseRef.current.x;
      const dy = e.clientY - lastMouseRef.current.y;
      dragDistanceRef.current += Math.abs(dx) + Math.abs(dy);
      lastMouseRef.current = { x: e.clientX, y: e.clientY };

      // Thread drag mode per Spec 04 Section 9 - move thread position instead of panning
      if (threadDragRef.current && dragDistanceRef.current > 5) {
        if (!isThreadDragging) setIsThreadDragging(true);
        const renderer = rendererRef.current;
        const container = containerRef.current;
        if (renderer && container) {
          const rect = container.getBoundingClientRect();
          const screenX = e.clientX - rect.left;
          const screenY = e.clientY - rect.top;
          const cam = renderer.getCameraState();
          const mapPos = screenToMap(screenX, screenY, cam, rect.width, rect.height);
          useThreadStore.getState().updateThread(threadDragRef.current.threadId, {
            position: mapPos,
          });
        }
        return; // Skip panning and edge scrolling during thread drag
      }

      rendererRef.current?.pan(-dx, -dy);

      // Edge scrolling per Spec 08 (only during drag)
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const edgeDir = computeEdgeScroll(localX, localY, rect.width, rect.height);
      useNavigationStore.getState().setEdgeScrollDirection(edgeDir);
    },
    [isThreadDragging],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const wasDragging = dragDistanceRef.current > 5;
      isDraggingRef.current = false;
      useNavigationStore.getState().setEdgeScrollDirection(null);

      // Clear agent drag visuals
      rendererRef.current?.setAgentDragState({
        active: false,
        validClusterIds: new Set(),
        invalidClusterIds: new Set(),
        alreadyDeployedClusterIds: new Set(),
        hoverClusterId: null,
      });

      // Handle thread drag-to-zone reclassification per Spec 04 Section 9
      const threadDrag = threadDragRef.current;
      threadDragRef.current = null;
      if (isThreadDragging) setIsThreadDragging(false);
      if (threadDrag && wasDragging) {
        const renderer = rendererRef.current;
        const container = containerRef.current;
        if (renderer && container) {
          const rect = container.getBoundingClientRect();
          const screenX = e.clientX - rect.left;
          const screenY = e.clientY - rect.top;
          const cam = renderer.getCameraState();
          const mapPos = screenToMap(screenX, screenY, cam, rect.width, rect.height);

          const thread = useThreadStore.getState().threads.get(threadDrag.threadId);
          if (thread) {
            const targetZone = getZoneAtPosition(zonesRef.current, mapPos.x, mapPos.y);
            const updated = onManualReclassify(thread, zonesRef.current, targetZone, mapPos);
            useThreadStore.getState().updateThread(threadDrag.threadId, updated);

            // Spec 11 Section 9: if thread was in a cluster, check if dropped outside it
            if (threadDrag.clusterId) {
              const cluster = clustersRef.current.find((c) => c.id === threadDrag.clusterId);
              if (cluster) {
                // Check if drop position is outside cluster boundary
                const memberPositions = cluster.memberThreadIds
                  .filter((tid) => tid !== threadDrag.threadId)
                  .map((tid) => useThreadStore.getState().threads.get(tid))
                  .filter(Boolean)
                  .map((t) => t!.position);

                if (memberPositions.length > 0) {
                  const padding = 80; // generous boundary check
                  const minX = Math.min(...memberPositions.map((p) => p.x)) - padding;
                  const maxX = Math.max(...memberPositions.map((p) => p.x)) + padding;
                  const minY = Math.min(...memberPositions.map((p) => p.y)) - padding;
                  const maxY = Math.max(...memberPositions.map((p) => p.y)) + padding;

                  if (mapPos.x < minX || mapPos.x > maxX || mapPos.y < minY || mapPos.y > maxY) {
                    excludeFromCluster(threadDrag.threadId, threadDrag.clusterId);
                  }
                }
              }
            }

            // Update thread counts immediately
            const threadArray = [...useThreadStore.getState().threads.values()];
            const counts: Record<ZoneId, number> = {
              "active-front": 0,
              opportunities: 0,
              "at-risk": 0,
              lost: 0,
              noise: 0,
              "base-handled": 0,
            };
            for (const t of threadArray) {
              counts[t.zone]++;
            }
            updateZoneSizes(zonesRef.current, counts);
            setZonesSnapshot(new Map(zonesRef.current));
          }
        }
        return;
      }

      // Handle agent drop per Spec 06 - if an agent is being dragged, validate and show confirmation
      const deployDrag = useDeploymentStore.getState().dragState;
      if (deployDrag) {
        const renderer = rendererRef.current;
        const container = containerRef.current;
        if (renderer && container) {
          const rect = container.getBoundingClientRect();
          const screenX = e.clientX - rect.left;
          const screenY = e.clientY - rect.top;
          const cam = renderer.getCameraState();
          const mapPos = screenToMap(screenX, screenY, cam, rect.width, rect.height);
          const def = AGENT_DEFINITIONS[deployDrag.draggingRole];

          // Check for pre-selected clusters (Spec 06 Section 11 batch deployment)
          const selectedClusterIds = useDeploymentStore.getState().selectedClusterIds;
          if (selectedClusterIds.length > 1) {
            // Batch deployment mode: deploy to all selected clusters
            const threadArray = [...useThreadStore.getState().threads.values()];
            const threadMap = new Map(threadArray.map((t) => [t.id, t]));
            const batchTargets: BatchTarget[] = [];
            const allThreadIds: string[] = [];

            for (const clusterId of selectedClusterIds) {
              const cluster = clustersRef.current.find((c) => c.id === clusterId);
              if (!cluster) continue;
              const clusterThreadIds = cluster.memberThreadIds
                .filter((tid) => threadMap.has(tid))
                .slice(0, def.capacity);
              if (clusterThreadIds.length === 0) continue;
              batchTargets.push({
                clusterId: cluster.id,
                threadIds: clusterThreadIds,
                label: cluster.label,
              });
              allThreadIds.push(...clusterThreadIds);
            }

            if (batchTargets.length > 0) {
              useDeploymentStore.getState().showConfirmation({
                agentRole: deployDrag.draggingRole,
                clusterId: "batch",
                threadIds: allThreadIds,
                description: `${def.name}: ${def.description.toLowerCase()} across ${batchTargets.length} clusters`,
                batchTargets,
              });
            } else {
              useDeploymentStore.getState().cancelDrag();
            }
            return;
          }

          // Single drop: per Spec 11 Section 10, only clusters are valid deployment targets
          const dropCluster = hitTestCluster(
            clustersRef.current,
            mapPos.x,
            mapPos.y,
            200 / cam.zoom,
          );

          if (dropCluster) {
            const clusterThreadIds = dropCluster.memberThreadIds.slice(0, def.capacity);
            useDeploymentStore.getState().showConfirmation({
              agentRole: deployDrag.draggingRole,
              clusterId: dropCluster.id,
              threadIds: clusterThreadIds,
              description: `${def.name}: ${def.description.toLowerCase()} (${clusterThreadIds.length} thread${clusterThreadIds.length !== 1 ? "s" : ""} in ${dropCluster.label || "cluster"})`,
            });
          } else {
            // Invalid drop: no cluster at drop position, cancel
            useDeploymentStore.getState().cancelDrag();
          }
        } else {
          useDeploymentStore.getState().cancelDrag();
        }
        return;
      }

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

      // Ctrl+click cluster selection for batch deployment (Spec 06 Section 11)
      if (e.ctrlKey || e.metaKey) {
        const hitCluster = hitTestCluster(clustersRef.current, mapPos.x, mapPos.y, 120 / cam.zoom);
        if (hitCluster) {
          useDeploymentStore.getState().toggleClusterSelection(hitCluster.id);
          return;
        }
      }

      // Clear cluster selection on non-Ctrl clicks
      if (useDeploymentStore.getState().selectedClusterIds.length > 0) {
        useDeploymentStore.getState().clearClusterSelection();
      }

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
        // Shift+click: batch selection per Spec 09 Batch Operations
        if (e.shiftKey) {
          useThreadStore.getState().toggleBatchSelect(hitId);
          return;
        }

        const zoomLevel = cam.level;
        if (zoomLevel === "strategic") {
          // At strategic zoom, click cluster dot -> zoom to tactical per Spec 08
          const thread = useThreadStore.getState().threads.get(hitId);
          if (thread) {
            useNavigationStore.getState().saveCameraHistory();
            renderer.animateTo(thread.position.x, thread.position.y, getCanonicalZoom("tactical"));
          }
        } else if (zoomLevel === "tactical") {
          // At tactical zoom, threads are dots without labels - no selection per Spec 08
          // Zoom closer to see details
          const thread = useThreadStore.getState().threads.get(hitId);
          if (thread) {
            useNavigationStore.getState().saveCameraHistory();
            renderer.animateTo(
              thread.position.x,
              thread.position.y,
              getCanonicalZoom("operational"),
            );
          }
        } else {
          // Operational/Detail: single click -> select per Spec 08
          // Clear batch selection on normal click
          if (useThreadStore.getState().selectedThreadIds.size > 0) {
            useThreadStore.getState().clearBatchSelection();
          }
          selectThread(hitId);
          useNavigationStore.getState().openDetailPanel();
          // Trigger New->Active lifecycle transition on thread open per Spec 09
          const thread = useThreadStore.getState().threads.get(hitId);
          if (thread && thread.lifecycleState === "new") {
            useThreadStore.getState().transitionState(hitId, "active", "user-opened");
          }
        }
      } else {
        // At strategic zoom, try hitting cluster aggregate dots per Spec 08 Section 9
        if (cam.level === "strategic") {
          const hitCluster = hitTestCluster(clustersRef.current, mapPos.x, mapPos.y);
          if (hitCluster) {
            useNavigationStore.getState().saveCameraHistory();
            renderer.animateTo(
              hitCluster.centroid.x,
              hitCluster.centroid.y,
              getCanonicalZoom("tactical"),
            );
            return;
          }
        }

        // Click empty space -> clear selection per Spec 08
        selectThread(null);
        useNavigationStore.getState().closeDetailPanel();
        // Also clear batch selection
        if (useThreadStore.getState().selectedThreadIds.size > 0) {
          useThreadStore.getState().clearBatchSelection();
        }
      }
    },
    [selectThread, isThreadDragging],
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

  // -- Pinch-to-zoom gesture per Spec 08 Section 5 --
  const pinchRef = useRef<{ startDistance: number; lastDistance: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const dist = Math.hypot(dx, dy);
      pinchRef.current = { startDistance: dist, lastDistance: dist };
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const renderer = rendererRef.current;
      if (!renderer) return;

      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const dist = Math.hypot(dx, dy);
      const prevLevel = renderer.getCameraState().level;

      // Zoom factor from distance delta, anchored at midpoint per Spec 08
      const factor = dist / pinchRef.current.lastDistance;
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        renderer.zoom(factor, midX, midY);
      }

      pinchRef.current.lastDistance = dist;

      const newLevel = renderer.getCameraState().level;
      if (newLevel !== prevLevel) {
        useNavigationStore.getState().saveCameraHistory();
      }
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      pinchRef.current = null;
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

      // Escape - three-step back navigation per Spec 08 Section 14
      // Step 1: If composer active, dismiss composer
      // Step 2: If detail panel open, close detail panel and clear selection
      // Step 3: Back navigation to previous camera state
      if (e.key === "Escape") {
        e.preventDefault();
        const navStore = useNavigationStore.getState();
        const currentSelection = useThreadStore.getState().selectedThreadId;

        if (navStore.composerActive) {
          // Step 1: dismiss composer, keep detail panel open
          navStore.setComposerActive(false);
        } else if (navStore.detailPanelOpen) {
          // Step 2: close detail panel, clear selection
          selectThread(null);
          navStore.closeDetailPanel();
        } else if (currentSelection) {
          // Clear selection
          selectThread(null);
        } else {
          // Step 3: back navigation
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
            // Trigger New->Active lifecycle transition on thread open per Spec 09
            const thread = useThreadStore.getState().threads.get(nearest);
            if (thread && thread.lifecycleState === "new") {
              useThreadStore.getState().transitionState(nearest, "active", "user-opened");
            }
            if (thread) {
              renderer.animateTo(thread.position.x, thread.position.y, cam.zoom);
            }
          }
          return;
        }

        const nextId = findNextThreadInDirection(threadArray, currentId, e.key, cam.level);
        if (nextId) {
          selectThread(nextId);
          // Trigger New->Active lifecycle transition on thread open per Spec 09
          const thread = useThreadStore.getState().threads.get(nextId);
          if (thread && thread.lifecycleState === "new") {
            useThreadStore.getState().transitionState(nextId, "active", "user-opened");
          }
          if (thread) {
            renderer.animateTo(thread.position.x, thread.position.y, cam.zoom);
          }
        }
        return;
      }

      // Tab - cycle through zone labels per Spec 08 Section 16
      if (e.key === "Tab") {
        e.preventDefault();
        const zoneIds: ZoneId[] = [
          "active-front",
          "opportunities",
          "at-risk",
          "lost",
          "noise",
          "base-handled",
        ];
        const currentFocused = tabFocusedZoneRef.current;
        const currentIdx = currentFocused ? zoneIds.indexOf(currentFocused) : -1;
        const direction = e.shiftKey ? -1 : 1;
        const nextIdx =
          currentIdx === -1 ? 0 : (currentIdx + direction + zoneIds.length) % zoneIds.length;
        tabFocusedZoneRef.current = zoneIds[nextIdx];
        setTabFocusedZone(zoneIds[nextIdx]);
        return;
      }

      // Enter on focused zone label -> navigate to zone per Spec 08
      if (e.key === "Enter" && tabFocusedZoneRef.current && !selectedThreadId) {
        e.preventDefault();
        const zoneId = tabFocusedZoneRef.current;
        const zone = zonesRef.current.get(zoneId);
        if (zone && renderer) {
          const container = containerRef.current;
          const vw = container?.clientWidth ?? 800;
          const vh = container?.clientHeight ?? 600;
          const zoneTarget = zoomToFitZone(zone, vw, vh);
          useNavigationStore.getState().saveCameraHistory();
          renderer.animateTo(zoneTarget.centerX, zoneTarget.centerY, zoneTarget.zoom);
        }
        tabFocusedZoneRef.current = null;
        setTabFocusedZone(null);
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

      // Quick-deploy shortcuts (Shift+1 through Shift+6) per Spec 06
      // Deploys agent to threads near viewport center
      const QUICK_DEPLOY_ROLES: Record<string, AgentRole> = {
        "!": "closer", // Shift+1
        "@": "researcher", // Shift+2
        "#": "scheduler", // Shift+3
        $: "cleaner", // Shift+4
        "%": "drafter", // Shift+5
        "^": "escalation-bot", // Shift+6
      };
      const quickDeployRole = QUICK_DEPLOY_ROLES[e.key];
      if (quickDeployRole && e.shiftKey) {
        e.preventDefault();
        const agentStore = useAgentStore.getState();
        if (agentStore.canDeployRole(quickDeployRole)) {
          const cam = renderer.getCameraState();
          // Per Spec 11 Section 10: only clusters are valid deployment targets
          const nearCluster = hitTestCluster(clustersRef.current, cam.x, cam.y, 400 / cam.zoom);
          if (nearCluster) {
            const def = AGENT_DEFINITIONS[quickDeployRole];
            const clusterThreadIds = nearCluster.memberThreadIds.slice(0, def.capacity);
            useDeploymentStore.getState().showConfirmation({
              agentRole: quickDeployRole,
              clusterId: nearCluster.id,
              threadIds: clusterThreadIds,
              description: `${def.name}: ${def.description.toLowerCase()} (${clusterThreadIds.length} thread${clusterThreadIds.length !== 1 ? "s" : ""} in ${nearCluster.label || "cluster"})`,
            });
          }
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

  // -- Context menu state for right-click agent deploy per Spec 06 --
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    threadIds: string[];
    clusterId: string;
    zoneId: ZoneId;
  } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const renderer = rendererRef.current;
    const container = containerRef.current;
    if (!renderer || !container) return;

    const rect = container.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const cam = renderer.getCameraState();
    const mapPos = screenToMap(screenX, screenY, cam, rect.width, rect.height);

    // Hit-test clusters first
    const hitCluster = hitTestCluster(clustersRef.current, mapPos.x, mapPos.y, 120 / cam.zoom);
    if (hitCluster) {
      const threadArray = [...useThreadStore.getState().threads.values()];
      const threadMap = new Map(threadArray.map((t) => [t.id, t]));
      const clusterThreadIds = hitCluster.memberThreadIds.filter((tid) => threadMap.has(tid));
      const zoneId = getZoneAtPosition(zonesRef.current, mapPos.x, mapPos.y);
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        threadIds: clusterThreadIds,
        clusterId: hitCluster.id,
        zoneId,
      });
      return;
    }

    // Per Spec 11 Section 10: only clusters are valid deployment targets,
    // so context menu (which is for agent deployment) only appears on cluster hits
    // Individual unassigned threads are not deployable
    setContextMenu(null);
  }, []);

  const handleContextMenuSelect = useCallback(
    (role: AgentRole) => {
      if (!contextMenu) return;
      const def = AGENT_DEFINITIONS[role];
      const threadIds = contextMenu.threadIds.slice(0, def.capacity);
      useDeploymentStore.getState().showConfirmation({
        agentRole: role,
        clusterId: contextMenu.clusterId,
        threadIds,
        description: `${def.name}: ${def.description.toLowerCase()} (${threadIds.length} thread${threadIds.length !== 1 ? "s" : ""} in ${contextMenu.zoneId})`,
      });
      setContextMenu(null);
    },
    [contextMenu],
  );

  // Close context menu on any click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

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
    // Return focus to map per Spec 12 - both DOM focus and focus zone state
    containerRef.current?.focus();
    useAppStore.getState().setFocusZone("map");
  }, []);

  // -- Minimap navigation --

  const handleMinimapNavigate = useCallback((mapX: number, mapY: number) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    // Pan to clicked location; zoom does not change per Spec 08
    const cam = renderer.getCameraState();
    renderer.animateTo(mapX, mapY, cam.zoom);
  }, []);

  // Zone quick-nav click handler per Spec 08
  const handleZoneQuickNav = useCallback((zoneId: ZoneId) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const zone = zonesRef.current.get(zoneId);
    if (!zone) return;
    const container = containerRef.current;
    const vw = container?.clientWidth ?? 800;
    const vh = container?.clientHeight ?? 600;
    const zoneTarget = zoomToFitZone(zone, vw, vh);
    useNavigationStore.getState().saveCameraHistory();
    renderer.animateTo(zoneTarget.centerX, zoneTarget.centerY, zoneTarget.zoom);
  }, []);

  // Minimap shows only visible (filtered) threads per Spec 09
  const visibleThreadArray = getVisibleThreads([...threads.values()], filter);

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full outline-none ${isThreadDragging ? "cursor-move" : "cursor-grab active:cursor-grabbing"}`}
      data-testid="map-viewport"
      tabIndex={0}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
    >
      {/* Context menu for right-click agent deploy per Spec 06 */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-48 rounded border border-gray-700 bg-[#14142a] py-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          data-testid="deploy-context-menu"
          role="menu"
          aria-label="Deploy agent"
        >
          <div className="px-3 py-1 text-[10px] text-gray-500 uppercase">Deploy Agent</div>
          {(
            Object.entries(AGENT_DEFINITIONS) as [
              AgentRole,
              (typeof AGENT_DEFINITIONS)[AgentRole],
            ][]
          ).map(([role, def]) => {
            const agentState = useAgentStore.getState().agents.get(role);
            const canDeploy = useAgentStore.getState().canDeployRole(role);
            // Cluster compatibility filter per Spec 06 Section 13
            const clusterAlreadyDeployed = useDeploymentStore
              .getState()
              .deployments.some(
                (d) =>
                  d.agentRole === role &&
                  d.clusterId === contextMenu.clusterId &&
                  (d.status === "confirming" ||
                    d.status === "traveling" ||
                    d.status === "in-progress"),
              );
            const statusLabel = clusterAlreadyDeployed
              ? "Already deployed"
              : agentState?.status === "cooldown"
                ? "Cooldown"
                : agentState?.status === "working" || agentState?.status === "deployed"
                  ? "Busy"
                  : canDeploy
                    ? "Available"
                    : "Unavailable";
            const isAvailable = canDeploy && !clusterAlreadyDeployed;
            const colorHex = `#${def.color.toString(16).padStart(6, "0")}`;

            return (
              <button
                key={role}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                  isAvailable
                    ? "text-gray-300 hover:bg-gray-700"
                    : "text-gray-600 cursor-not-allowed"
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isAvailable) handleContextMenuSelect(role);
                }}
                disabled={!isAvailable}
                role="menuitem"
                data-testid={`context-menu-${role}`}
              >
                <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorHex }} />
                <span className="flex-1">{def.name}</span>
                <span
                  className={`text-[10px] ${isAvailable ? "text-green-500" : "text-gray-600"}`}
                  data-testid={`context-menu-${role}-status`}
                >
                  {statusLabel}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {/* Agent deployment tooltip per Spec 06 Section 8 */}
      {agentTooltip && (
        <div
          className="pointer-events-none fixed z-50 rounded border border-gray-700 bg-[#14142a] px-3 py-2 text-xs text-gray-300 shadow-xl"
          style={{ left: agentTooltip.x + 12, top: agentTooltip.y - 8 }}
          data-testid="agent-deploy-tooltip"
        >
          <div className="font-medium text-gray-200">{agentTooltip.agentRole}</div>
          <div className="text-gray-400">{Math.floor(agentTooltip.elapsed / 1000)}s elapsed</div>
          <div className="text-gray-400">{agentTooltip.threadCount} threads</div>
        </div>
      )}
      <SearchOverlay
        onSearch={handleSearch}
        onCycleNext={handleSearchCycleNext}
        onCyclePrevious={handleSearchCyclePrev}
        onClose={handleSearchClose}
      />
      <ZoneQuickNav onNavigate={handleZoneQuickNav} focusedZone={tabFocusedZone} />
      <Minimap
        threads={visibleThreadArray}
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
