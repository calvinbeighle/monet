// Map rendering engine per Spec 02
// PixiJS-based WebGL renderer with layer system:
//   Background (zones) -> Mid (connections) -> Foreground (threads/clusters) -> Overlay (agents, UI)

import { Application, Container, Graphics, Text, TextStyle, type ColorSource } from "pixi.js";
import type { Thread, Zone, ZoneId } from "../../lib/types";
import type { Cluster } from "../../lib/types/cluster";

// Visual constants
const THREAD_BASE_RADIUS = 8;
const THREAD_VALUE_SCALE = 2.0; // value score multiplier for radius
const URGENCY_PULSE_BASE_RATE = 0.5; // base pulse frequency in Hz
const URGENCY_PULSE_MAX_RATE = 3.0;
const AGE_OPACITY_DECAY_DAYS = 30; // thread fully faded after this many days
const CLUSTER_BOUNDARY_COLOR = 0x8888cc;
const CLUSTER_BOUNDARY_ALPHA = 0.25;
const CLUSTER_AGGREGATE_COLOR = 0x6666aa;
const CLUSTER_PADDING = 30; // padding around member positions for boundary

export interface MapRendererOptions {
  container: HTMLElement;
  width: number;
  height: number;
}

export class MapRenderer {
  private app: Application | null = null;
  private layers: {
    background: Container;
    mid: Container;
    foreground: Container;
    overlay: Container;
  } | null = null;

  // Entity graphics pools
  private zoneGraphics: Map<ZoneId, Graphics> = new Map();
  private zoneLabels: Map<ZoneId, Text> = new Map();
  private threadGraphics: Map<string, Graphics> = new Map();
  private threadLabels: Map<string, Text> = new Map();
  private clusterGraphics: Map<string, Graphics> = new Map();
  private clusterLabels: Map<string, Text> = new Map();
  // Selection ring rendered inline in renderThreads

  // Camera state
  private cameraX = 0;
  private cameraY = 0;
  private cameraZoom = 0.5; // start zoomed out to see whole map

  // Selection and search state (set by viewport, used during render)
  private selectedThreadId: string | null = null;
  private batchSelectedIds: Set<string> = new Set();
  private searchHighlightIds: Set<string> = new Set();
  private searchActive = false;

  // In-progress deployment cluster IDs per Spec 06 Section 4
  private inProgressClusterIds: Set<string> = new Set();

  // Travel arc animations per Spec 06
  private travelAnimations: Array<{
    agentColor: number;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    startTime: number;
    duration: number;
  }> = [];

  // Agent drag visual state per Spec 06 Section 3
  private agentDragState: {
    active: boolean;
    validClusterIds: Set<string>;
    invalidClusterIds: Set<string>;
    alreadyDeployedClusterIds: Set<string>;
    hoverClusterId: string | null;
  } = {
    active: false,
    validClusterIds: new Set(),
    invalidClusterIds: new Set(),
    alreadyDeployedClusterIds: new Set(),
    hoverClusterId: null,
  };

  // Object pools for recycled Graphics/Text
  private graphicsPool: Graphics[] = [];
  private textPool: Text[] = [];

  // Dirty flagging - cache of last-rendered state per thread
  private threadRenderCache: Map<
    string,
    {
      x: number;
      y: number;
      urgency: number;
      value: number;
      visualState: string;
      selected: boolean;
      batchSelected: boolean;
    }
  > = new Map();

  // Animation state
  private pulseTime = 0;
  private zoomAnimationTarget: { x: number; y: number; zoom: number } | null = null;
  private zoomAnimationSpeed = 0.08; // fraction per frame

  // Smoothed urgency for fade-out per Spec 02 (lerps toward actual urgency)
  private smoothedUrgency: Map<string, number> = new Map();
  private static URGENCY_LERP_SPEED = 2.0; // units per second

  // Zoom density blend factor for smooth transitions per Spec 02
  private zoomBlend = 0; // 0 = fully aggregate, 1 = fully individual
  private lastDeltaSec = 0.016; // frame delta for urgency smoothing

  async init(options: MapRendererOptions): Promise<void> {
    this.app = new Application();
    await this.app.init({
      width: options.width,
      height: options.height,
      backgroundColor: 0x0a0a12,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    options.container.appendChild(this.app.canvas as HTMLCanvasElement);

    // Create layer hierarchy per Spec 02
    const world = new Container();
    this.app.stage.addChild(world);

    this.layers = {
      background: new Container(),
      mid: new Container(),
      foreground: new Container(),
      overlay: new Container(),
    };

    world.addChild(this.layers.background);
    world.addChild(this.layers.mid);
    world.addChild(this.layers.foreground);
    world.addChild(this.layers.overlay);

    // Set initial camera
    this.updateCamera(world);

    // Start render loop
    this.app.ticker.add((ticker) => this.onTick(ticker.deltaMS));
  }

  destroy(): void {
    if (this.app) {
      this.app.destroy(true, { children: true });
      this.app = null;
      this.layers = null;
    }
    this.zoneGraphics.clear();
    this.zoneLabels.clear();
    this.threadGraphics.clear();
    this.threadLabels.clear();
    this.smoothedUrgency.clear();
    this.clusterGraphics.clear();
    this.clusterLabels.clear();
    this.graphicsPool.length = 0;
    this.textPool.length = 0;
    this.threadRenderCache.clear();
  }

  // Camera control
  pan(dx: number, dy: number): void {
    this.cameraX += dx / this.cameraZoom;
    this.cameraY += dy / this.cameraZoom;
    if (this.app) {
      this.updateCamera(this.app.stage.children[0] as Container);
    }
  }

  zoom(factor: number, anchorX: number, anchorY: number): void {
    const oldZoom = this.cameraZoom;
    this.cameraZoom = Math.max(0.1, Math.min(2.0, this.cameraZoom * factor));

    // Anchor zoom to cursor position
    const zoomRatio = this.cameraZoom / oldZoom;
    this.cameraX = anchorX - (anchorX - this.cameraX) * zoomRatio;
    this.cameraY = anchorY - (anchorY - this.cameraY) * zoomRatio;

    if (this.app) {
      this.updateCamera(this.app.stage.children[0] as Container);
    }
  }

  getZoomLevel(): "strategic" | "tactical" | "operational" | "detail" {
    if (this.cameraZoom < 0.25) return "strategic";
    if (this.cameraZoom < 0.6) return "tactical";
    if (this.cameraZoom < 1.2) return "operational";
    return "detail";
  }

  private updateCamera(world: Container): void {
    world.scale.set(this.cameraZoom);
    world.position.set(
      -this.cameraX * this.cameraZoom + (this.app?.screen.width ?? 0) / 2,
      -this.cameraY * this.cameraZoom + (this.app?.screen.height ?? 0) / 2,
    );
  }

  resize(width: number, height: number): void {
    if (this.app) {
      this.app.renderer.resize(width, height);
      this.updateCamera(this.app.stage.children[0] as Container);
    }
  }

  // Render zones as background layer
  renderZones(zones: Map<ZoneId, Zone>): void {
    if (!this.layers) return;

    for (const [id, zone] of zones) {
      let g = this.zoneGraphics.get(id);
      if (!g) {
        g = new Graphics();
        this.layers.background.addChild(g);
        this.zoneGraphics.set(id, g);
      }

      const b = zone.boundary;
      g.clear();

      // Zone fill
      g.rect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
      g.fill({ color: zone.colorTint as ColorSource, alpha: 0.3 });

      // Zone border - alert state changes visual per Spec 04
      const borderWidth = zone.alertState === "active" ? 3 : 2;
      const borderAlpha = zone.alertState === "active" ? 0.8 : 0.5;
      const borderColor = zone.alertState === "active" ? 0xdd3333 : zone.borderColor;
      g.rect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
      g.stroke({ color: borderColor as ColorSource, width: borderWidth, alpha: borderAlpha });

      // Zone label
      let label = this.zoneLabels.get(id);
      if (!label) {
        label = new Text({
          text: "",
          style: new TextStyle({
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: 18,
            fill: 0xffffff,
            align: "center",
          }),
        });
        label.alpha = 0.4;
        this.layers.background.addChild(label);
        this.zoneLabels.set(id, label);
      }
      const alertPrefix = zone.alertState === "active" ? "! " : "";
      label.text = `${alertPrefix}${zone.name} (${zone.threadCount})`;
      label.alpha = zone.alertState === "active" ? 0.7 : 0.4;
      label.position.set((b.minX + b.maxX) / 2 - label.width / 2, b.minY + 10);
    }
  }

  // Render thread entities on foreground layer
  renderThreads(threads: Thread[], now: number = Date.now()): void {
    if (!this.layers) return;

    const activeIds = new Set(threads.map((t) => t.id));

    // Remove graphics for threads that no longer exist (pool instead of destroy)
    for (const [id, g] of this.threadGraphics) {
      if (!activeIds.has(id)) {
        this.releaseGraphics(g, this.threadGraphics, id);
        const label = this.threadLabels.get(id);
        if (label) {
          this.releaseText(label, this.threadLabels, id);
        }
        this.threadRenderCache.delete(id);
      }
    }

    const zoomLevel = this.getZoomLevel();
    const bounds = this.getVisibleBounds();

    for (const thread of threads) {
      // Viewport culling - skip entities outside visible area
      // When search is active, keep all threads visible for dimming effect
      if (!this.searchActive && !this.isInBounds(thread.position.x, thread.position.y, bounds)) {
        const existingG = this.threadGraphics.get(thread.id);
        if (existingG) existingG.visible = false;
        const existingL = this.threadLabels.get(thread.id);
        if (existingL) existingL.visible = false;
        continue;
      }

      let g = this.threadGraphics.get(thread.id);
      if (!g) {
        g = this.acquireGraphics(this.layers.foreground);
        this.threadGraphics.set(thread.id, g);
      }

      // Dirty flagging - skip full redraw if render-relevant properties unchanged
      // Only skip for low-urgency threads (high-urgency ones need pulse animation updates)
      const cacheKey = {
        x: thread.position.x,
        y: thread.position.y,
        urgency: thread.urgencyScore,
        value: thread.valueScore,
        visualState: thread.visualState,
        selected: thread.id === this.selectedThreadId,
        batchSelected: this.batchSelectedIds.has(thread.id),
      };
      const cached = this.threadRenderCache.get(thread.id);
      if (
        thread.urgencyScore <= 0.5 &&
        cached &&
        cached.x === cacheKey.x &&
        cached.y === cacheKey.y &&
        cached.urgency === cacheKey.urgency &&
        cached.value === cacheKey.value &&
        cached.visualState === cacheKey.visualState &&
        cached.selected === cacheKey.selected &&
        cached.batchSelected === cacheKey.batchSelected
      ) {
        g.visible = true;
        continue;
      }
      this.threadRenderCache.set(thread.id, cacheKey);

      g.clear();

      // Size driven by value score per Spec 02
      const radius =
        THREAD_BASE_RADIUS + thread.valueScore * THREAD_BASE_RADIUS * THREAD_VALUE_SCALE;

      // Color intensity driven by urgency per Spec 02
      const color = this.getUrgencyColor(thread.urgencyScore);

      // Age-driven opacity per Spec 02
      const ageMs = now - thread.firstMessageTimestamp;
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const ageAlpha = Math.max(0.2, 1.0 - ageDays / AGE_OPACITY_DECAY_DAYS);

      // Archived thread minimum opacity
      const alpha = thread.visualState === "archived" ? 0.15 : ageAlpha;

      // Smoothed urgency for fade-out per Spec 02
      const prevSmoothed = this.smoothedUrgency.get(thread.id) ?? thread.urgencyScore;
      const diff = thread.urgencyScore - prevSmoothed;
      const maxStep = MapRenderer.URGENCY_LERP_SPEED * (this.lastDeltaSec || 0.016);
      const smoothed = prevSmoothed + Math.sign(diff) * Math.min(maxStep, Math.abs(diff));
      this.smoothedUrgency.set(thread.id, smoothed);

      // Urgency pulse per Spec 02 (uses smoothed value for gradual fade-out)
      const pulseRate =
        URGENCY_PULSE_BASE_RATE + smoothed * (URGENCY_PULSE_MAX_RATE - URGENCY_PULSE_BASE_RATE);
      const pulse = 1.0 + Math.sin(this.pulseTime * pulseRate * Math.PI * 2) * 0.15 * smoothed;

      // Draw the thread entity
      const r = radius * pulse;

      // Glow for high urgency (uses smoothed value for fade-out)
      if (smoothed > 0.5) {
        g.circle(thread.position.x, thread.position.y, r * 1.5);
        g.fill({ color: color as ColorSource, alpha: alpha * 0.2 });
      }

      // Main circle
      g.circle(thread.position.x, thread.position.y, r);
      g.fill({ color: color as ColorSource, alpha: alpha * 0.8 });

      // Agent-occupied indicator per Spec 02
      if (thread.visualState === "agent-occupied") {
        g.circle(thread.position.x, thread.position.y, r + 4);
        g.stroke({ color: 0xffd700 as ColorSource, width: 2, alpha: 0.7 });
      }

      // Batch selection ring per Spec 09 (distinct from single selection)
      if (this.batchSelectedIds.has(thread.id)) {
        g.circle(thread.position.x, thread.position.y, r + 6);
        g.stroke({ color: 0x00ccff as ColorSource, width: 2, alpha: 0.8 });
      }

      // Selection ring per Spec 08
      if (thread.id === this.selectedThreadId) {
        g.circle(thread.position.x, thread.position.y, r + 6);
        g.stroke({ color: 0xffffff as ColorSource, width: 2, alpha: 0.9 });
      }

      // Search dimming per Spec 08: non-matching entities visually recede
      if (this.searchActive && this.searchHighlightIds.size > 0) {
        if (!this.searchHighlightIds.has(thread.id)) {
          g.alpha = 0.2;
        } else {
          g.alpha = 1.0;
        }
      } else {
        g.alpha = 1.0;
      }

      // Label (only at operational zoom or higher)
      if (zoomLevel === "operational" || zoomLevel === "detail") {
        let label = this.threadLabels.get(thread.id);
        if (!label) {
          label = this.acquireText(this.layers.foreground);
          this.threadLabels.set(thread.id, label);
        }

        const sender = thread.participants[0]?.displayName ?? thread.participants[0]?.email ?? "";
        label.text = sender ? `${sender}\n${thread.subject}` : thread.subject;
        label.position.set(thread.position.x + r + 4, thread.position.y - 8);
        label.alpha = alpha * 0.8;
        label.visible = true;
      } else {
        const label = this.threadLabels.get(thread.id);
        if (label) label.visible = false;
      }
    }
  }

  // Render connection lines between related threads per Spec 02 Section 3
  // Threads sharing a participant get a faint edge on the mid layer.
  // When clustered at low zoom, edges attach to cluster centroids instead.
  renderConnections(threads: Thread[], clusters: Cluster[]): void {
    if (!this.layers) return;

    // Clear previous connections (mid layer holds only connections now)
    const mid = this.layers.mid;
    while (mid.children.length > 0) mid.removeChildAt(0);

    const zoomLevel = this.getZoomLevel();
    const bounds = this.getVisibleBounds();

    // Build participant -> threadId[] index
    const participantThreads = new Map<string, string[]>();
    for (const t of threads) {
      for (const p of t.participants) {
        let list = participantThreads.get(p.email);
        if (!list) {
          list = [];
          participantThreads.set(p.email, list);
        }
        list.push(t.id);
      }
    }

    // Build threadId -> cluster centroid map for low-zoom attachment
    const threadClusterCentroid = new Map<string, { x: number; y: number }>();
    if (zoomLevel === "strategic" || zoomLevel === "tactical") {
      for (const c of clusters) {
        for (const tid of c.memberThreadIds) {
          threadClusterCentroid.set(tid, c.centroid);
        }
      }
    }

    const threadMap = new Map(threads.map((t) => [t.id, t]));
    const drawnEdges = new Set<string>();
    const g = new Graphics();
    mid.addChild(g);

    for (const threadIds of participantThreads.values()) {
      if (threadIds.length < 2) continue;
      // Draw edges between pairs (limit to avoid O(n^2) explosion)
      const limit = Math.min(threadIds.length, 8);
      for (let i = 0; i < limit; i++) {
        for (let j = i + 1; j < limit; j++) {
          const a = threadIds[i];
          const b = threadIds[j];
          const key = a < b ? `${a}:${b}` : `${b}:${a}`;
          if (drawnEdges.has(key)) continue;
          drawnEdges.add(key);

          const tA = threadMap.get(a);
          const tB = threadMap.get(b);
          if (!tA || !tB) continue;

          // Use cluster centroid at low zoom, thread position at high zoom
          const posA = threadClusterCentroid.get(a) ?? tA.position;
          const posB = threadClusterCentroid.get(b) ?? tB.position;

          // Skip if both endpoints are outside viewport
          const inA = this.isInBounds(posA.x, posA.y, bounds);
          const inB = this.isInBounds(posB.x, posB.y, bounds);
          if (!inA && !inB) continue;

          g.moveTo(posA.x, posA.y);
          g.lineTo(posB.x, posB.y);
          g.stroke({ color: 0x4466aa as ColorSource, width: 1, alpha: 0.12 });
        }
      }
    }
  }

  // Render cluster visuals per Spec 02 section 5
  // At operational/detail: draw boundary around members with label
  // At strategic/tactical: collapse to aggregate representation (single dot + count)
  renderClusters(clusters: Cluster[], threads: Thread[], _now: number = Date.now()): void {
    if (!this.layers) return;

    const activeClusterIds = new Set(clusters.map((c) => c.id));

    // Remove graphics for clusters that no longer exist (pool instead of destroy)
    for (const [id, g] of this.clusterGraphics) {
      if (!activeClusterIds.has(id)) {
        this.releaseGraphics(g, this.clusterGraphics, id);
        const label = this.clusterLabels.get(id);
        if (label) {
          this.releaseText(label, this.clusterLabels, id);
        }
      }
    }

    const zoomLevel = this.getZoomLevel();
    const bounds = this.getVisibleBounds();
    const threadMap = new Map(threads.map((t) => [t.id, t]));

    for (const cluster of clusters) {
      // Get member positions
      const memberPositions: { x: number; y: number }[] = [];
      let maxUrgency = 0;
      for (const tid of cluster.memberThreadIds) {
        const t = threadMap.get(tid);
        if (t) {
          memberPositions.push(t.position);
          maxUrgency = Math.max(maxUrgency, t.urgencyScore);
        }
      }
      if (memberPositions.length < 2) continue;

      // Viewport culling for clusters
      if (!this.isInBounds(cluster.centroid.x, cluster.centroid.y, bounds)) {
        const existingG = this.clusterGraphics.get(cluster.id);
        if (existingG) existingG.visible = false;
        const existingL = this.clusterLabels.get(cluster.id);
        if (existingL) existingL.visible = false;
        continue;
      }

      let g = this.clusterGraphics.get(cluster.id);
      if (!g) {
        g = this.acquireGraphics(this.layers.foreground);
        this.clusterGraphics.set(cluster.id, g);
      }
      g.clear();

      // Zoom density blend: aggregate fades out as zoomBlend increases, individual fades in
      const aggAlpha = 1.0 - this.zoomBlend; // 1 at low zoom, 0 at high zoom
      const indAlpha = this.zoomBlend; // 0 at low zoom, 1 at high zoom

      // Aggregate representation (fades out as zoom increases)
      if (aggAlpha > 0.01) {
        const r = 12 + cluster.memberThreadIds.length * 3;
        const color = this.getUrgencyColor(maxUrgency);

        // Glow
        g.circle(cluster.centroid.x, cluster.centroid.y, r * 1.4);
        g.fill({ color: color as ColorSource, alpha: 0.15 * aggAlpha });
        // Main circle
        g.circle(cluster.centroid.x, cluster.centroid.y, r);
        g.fill({ color: CLUSTER_AGGREGATE_COLOR as ColorSource, alpha: 0.6 * aggAlpha });
        // Urgency ring
        g.circle(cluster.centroid.x, cluster.centroid.y, r);
        g.stroke({ color: color as ColorSource, width: 2, alpha: 0.5 * aggAlpha });

        // Agent drag target validation visuals per Spec 06 Section 3
        if (this.agentDragState.active) {
          const isHovered = this.agentDragState.hoverClusterId === cluster.id;
          if (this.agentDragState.alreadyDeployedClusterIds.has(cluster.id)) {
            g.circle(cluster.centroid.x, cluster.centroid.y, r + 4);
            g.stroke({ color: 0xddaa22 as ColorSource, width: 2, alpha: 0.6 * aggAlpha });
          } else if (this.agentDragState.validClusterIds.has(cluster.id)) {
            const borderWidth = isHovered ? 4 : 3;
            g.circle(cluster.centroid.x, cluster.centroid.y, r + 4);
            g.stroke({ color: 0x44cc44 as ColorSource, width: borderWidth, alpha: 0.7 * aggAlpha });
          } else if (this.agentDragState.invalidClusterIds.has(cluster.id)) {
            g.circle(cluster.centroid.x, cluster.centroid.y, r + 4);
            g.stroke({ color: 0xcc4444 as ColorSource, width: 2, alpha: 0.4 * aggAlpha });
          }
        }

        // In-progress deployment indicator per Spec 06 Section 4
        if (this.inProgressClusterIds.has(cluster.id)) {
          const pulseAlpha = (0.3 + 0.3 * Math.sin(this.pulseTime * 3.0)) * aggAlpha;
          g.circle(cluster.centroid.x, cluster.centroid.y, r + 8);
          g.stroke({ color: 0xffd700 as ColorSource, width: 3, alpha: pulseAlpha });
        }

        // Count label
        let label = this.clusterLabels.get(cluster.id);
        if (!label) {
          label = this.acquireText(this.layers.foreground);
          label.style.fontSize = 13;
          label.style.fill = 0xffffff;
          label.style.align = "center";
          this.clusterLabels.set(cluster.id, label);
        }
        label.text = `${cluster.memberThreadIds.length}`;
        label.position.set(
          cluster.centroid.x - label.width / 2,
          cluster.centroid.y - label.height / 2,
        );
        label.alpha = 0.9 * aggAlpha;
        label.visible = aggAlpha > 0.01;
      } else {
        // Fully individual - hide aggregate label
        const label = this.clusterLabels.get(cluster.id);
        if (label) label.visible = false;
      }

      // Fade member thread graphics based on blend
      for (const tid of cluster.memberThreadIds) {
        const tg = this.threadGraphics.get(tid);
        if (tg) {
          tg.visible = indAlpha > 0.01;
          tg.alpha = indAlpha;
        }
        const tl = this.threadLabels.get(tid);
        if (tl && indAlpha <= 0.01) tl.visible = false;
      }

      // Boundary representation (fades in as zoom increases)
      if (indAlpha > 0.01) {
        const minX = Math.min(...memberPositions.map((p) => p.x)) - CLUSTER_PADDING;
        const minY = Math.min(...memberPositions.map((p) => p.y)) - CLUSTER_PADDING;
        const maxX = Math.max(...memberPositions.map((p) => p.x)) + CLUSTER_PADDING;
        const maxY = Math.max(...memberPositions.map((p) => p.y)) + CLUSTER_PADDING;
        const w = maxX - minX;
        const h = maxY - minY;
        const cornerRadius = Math.min(15, w * 0.1, h * 0.1);

        g.roundRect(minX, minY, w, h, cornerRadius);
        g.fill({
          color: CLUSTER_BOUNDARY_COLOR as ColorSource,
          alpha: CLUSTER_BOUNDARY_ALPHA * 0.3 * indAlpha,
        });
        g.roundRect(minX, minY, w, h, cornerRadius);
        g.stroke({
          color: CLUSTER_BOUNDARY_COLOR as ColorSource,
          width: 1.5,
          alpha: CLUSTER_BOUNDARY_ALPHA * indAlpha,
        });

        // Agent drag target validation visuals per Spec 06 Section 3
        if (this.agentDragState.active) {
          const isHovered = this.agentDragState.hoverClusterId === cluster.id;
          if (this.agentDragState.alreadyDeployedClusterIds.has(cluster.id)) {
            g.roundRect(minX - 2, minY - 2, w + 4, h + 4, cornerRadius);
            g.stroke({ color: 0xddaa22 as ColorSource, width: 2, alpha: 0.6 * indAlpha });
          } else if (this.agentDragState.validClusterIds.has(cluster.id)) {
            const borderWidth = isHovered ? 4 : 3;
            g.roundRect(minX - 2, minY - 2, w + 4, h + 4, cornerRadius);
            g.stroke({ color: 0x44cc44 as ColorSource, width: borderWidth, alpha: 0.7 * indAlpha });
          } else if (this.agentDragState.invalidClusterIds.has(cluster.id)) {
            g.roundRect(minX - 2, minY - 2, w + 4, h + 4, cornerRadius);
            g.stroke({ color: 0xcc4444 as ColorSource, width: 2, alpha: 0.4 * indAlpha });
          }
        }

        // In-progress deployment indicator per Spec 06 Section 4
        if (this.inProgressClusterIds.has(cluster.id)) {
          const pulseAlpha = (0.3 + 0.3 * Math.sin(this.pulseTime * 3.0)) * indAlpha;
          g.roundRect(minX - 4, minY - 4, w + 8, h + 8, cornerRadius);
          g.stroke({ color: 0xffd700 as ColorSource, width: 3, alpha: pulseAlpha });
        }

        // Cluster label above boundary
        if (zoomLevel === "operational" || zoomLevel === "detail") {
          let label = this.clusterLabels.get(cluster.id);
          if (!label) {
            label = this.acquireText(this.layers.foreground);
            label.style.fontSize = 11;
            label.style.fill = 0xaaaacc;
            label.style.align = "center";
            this.clusterLabels.set(cluster.id, label);
          }
          label.text = cluster.label;
          label.position.set((minX + maxX) / 2 - label.width / 2, minY - 16);
          label.alpha = 0.6 * indAlpha;
          label.visible = true;
        }
      }
    }

    // Ensure non-clustered threads remain visible
    const clusteredThreadIds = new Set(clusters.flatMap((c) => c.memberThreadIds));
    for (const [id, tg] of this.threadGraphics) {
      if (!clusteredThreadIds.has(id) && !tg.visible) {
        tg.visible = true;
      }
    }
  }

  // Viewport culling - compute visible world-space AABB
  private getVisibleBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    const sw = this.app?.screen.width ?? 1920;
    const sh = this.app?.screen.height ?? 1080;
    const margin = 100; // extra margin to avoid pop-in
    return {
      minX: this.cameraX - (sw / 2 + margin) / this.cameraZoom,
      minY: this.cameraY - (sh / 2 + margin) / this.cameraZoom,
      maxX: this.cameraX + (sw / 2 + margin) / this.cameraZoom,
      maxY: this.cameraY + (sh / 2 + margin) / this.cameraZoom,
    };
  }

  private isInBounds(
    x: number,
    y: number,
    bounds: ReturnType<typeof this.getVisibleBounds>,
  ): boolean {
    return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
  }

  // Object pool helpers
  private acquireGraphics(parent: Container): Graphics {
    const g = this.graphicsPool.pop();
    if (g) {
      g.clear();
      g.visible = true;
      parent.addChild(g);
      return g;
    }
    const ng = new Graphics();
    parent.addChild(ng);
    return ng;
  }

  private releaseGraphics(g: Graphics, map: Map<string, Graphics>, id: string): void {
    g.clear();
    g.visible = false;
    g.removeFromParent();
    map.delete(id);
    this.graphicsPool.push(g);
  }

  private acquireText(parent: Container): Text {
    const t = this.textPool.pop();
    if (t) {
      t.visible = true;
      parent.addChild(t);
      return t;
    }
    const nt = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 11,
        fill: 0xcccccc,
        wordWrap: true,
        wordWrapWidth: 120,
      }),
    });
    parent.addChild(nt);
    return nt;
  }

  private releaseText(t: Text, map: Map<string, Text>, id: string): void {
    t.visible = false;
    t.removeFromParent();
    map.delete(id);
    this.textPool.push(t);
  }

  private getUrgencyColor(urgency: number): number {
    // Gradient from cool blue (low urgency) to hot red (high urgency)
    if (urgency < 0.25) return 0x4488cc; // blue
    if (urgency < 0.5) return 0x66aa44; // green
    if (urgency < 0.75) return 0xddaa22; // amber
    return 0xdd3333; // red
  }

  private onTick(deltaMS: number): void {
    const deltaSec = deltaMS / 1000;
    this.lastDeltaSec = deltaSec;
    this.pulseTime += deltaSec;

    // Update zoom density blend factor per Spec 02
    // Blend between aggregate (0) and individual (1) near the tactical/operational threshold (0.6)
    const blendTarget =
      this.cameraZoom >= 0.6 ? 1.0 : this.cameraZoom < 0.25 ? 0.0 : (this.cameraZoom - 0.25) / 0.35;
    const blendSpeed = 3.0 * deltaSec; // ~330ms full transition
    this.zoomBlend +=
      Math.sign(blendTarget - this.zoomBlend) *
      Math.min(blendSpeed, Math.abs(blendTarget - this.zoomBlend));

    // Smooth camera animation per Spec 08
    if (this.zoomAnimationTarget) {
      const t = this.zoomAnimationTarget;
      const dx = t.x - this.cameraX;
      const dy = t.y - this.cameraY;
      const dz = t.zoom - this.cameraZoom;

      const speed = this.zoomAnimationSpeed * (deltaMS / 16.67); // normalize to 60fps
      this.cameraX += dx * speed;
      this.cameraY += dy * speed;
      this.cameraZoom += dz * speed;

      // Snap when close enough
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(dz) < 0.005) {
        this.cameraX = t.x;
        this.cameraY = t.y;
        this.cameraZoom = t.zoom;
        this.zoomAnimationTarget = null;
      }

      if (this.app) {
        this.updateCamera(this.app.stage.children[0] as Container);
      }
    }
  }

  getApp(): Application | null {
    return this.app;
  }

  getZoomBlend(): number {
    return this.zoomBlend;
  }

  getSmoothedUrgency(threadId: string): number | undefined {
    return this.smoothedUrgency.get(threadId);
  }

  getCameraState() {
    return {
      x: this.cameraX,
      y: this.cameraY,
      zoom: this.cameraZoom,
      level: this.getZoomLevel(),
    };
  }

  // Programmatic camera control for navigation system
  setCamera(x: number, y: number, zoom: number): void {
    this.cameraX = x;
    this.cameraY = y;
    this.cameraZoom = Math.max(0.1, Math.min(2.0, zoom));
    if (this.app) {
      this.updateCamera(this.app.stage.children[0] as Container);
    }
  }

  // Smooth animated camera transition per Spec 08
  animateTo(x: number, y: number, zoom: number): void {
    this.zoomAnimationTarget = {
      x,
      y,
      zoom: Math.max(0.1, Math.min(2.0, zoom)),
    };
  }

  isAnimating(): boolean {
    return this.zoomAnimationTarget !== null;
  }

  // Selection and search state (driven by viewport)
  setSelectedThread(id: string | null): void {
    this.selectedThreadId = id;
  }

  setBatchSelectedIds(ids: Set<string>): void {
    this.batchSelectedIds = ids;
  }

  setSearchHighlight(ids: string[], active: boolean): void {
    this.searchHighlightIds = new Set(ids);
    this.searchActive = active;
  }

  // Set agent drag visual state per Spec 06 Section 3
  setAgentDragState(state: {
    active: boolean;
    validClusterIds: Set<string>;
    invalidClusterIds: Set<string>;
    alreadyDeployedClusterIds: Set<string>;
    hoverClusterId: string | null;
  }): void {
    this.agentDragState = state;
  }

  getAgentDragState(): {
    active: boolean;
    validClusterIds: Set<string>;
    invalidClusterIds: Set<string>;
    alreadyDeployedClusterIds: Set<string>;
    hoverClusterId: string | null;
  } {
    return this.agentDragState;
  }

  getScreenWidth(): number {
    return this.app?.screen.width ?? 0;
  }

  getScreenHeight(): number {
    return this.app?.screen.height ?? 0;
  }

  // Set cluster IDs with in-progress deployments per Spec 06 Section 4
  setInProgressClusterIds(ids: Set<string>): void {
    this.inProgressClusterIds = ids;
  }

  getInProgressClusterIds(): Set<string> {
    return this.inProgressClusterIds;
  }

  // Travel arc animations per Spec 06
  setTravelAnimations(
    animations: Array<{
      agentColor: number;
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      startTime: number;
      duration: number;
    }>,
  ): void {
    this.travelAnimations = animations;
  }

  getTravelAnimations(): Array<{
    agentColor: number;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    startTime: number;
    duration: number;
  }> {
    return this.travelAnimations;
  }

  // Render travel arc animations on the overlay layer
  renderTravelArcs(now: number = Date.now()): void {
    if (!this.layers) return;

    for (const anim of this.travelAnimations) {
      const elapsed = now - anim.startTime;
      const t = Math.min(1.0, elapsed / anim.duration);
      if (t >= 1.0) continue; // completed, will be cleaned up by caller

      // Quadratic bezier arc: control point above midpoint for curved path
      const midX = (anim.startX + anim.endX) / 2;
      const midY = (anim.startY + anim.endY) / 2;
      const dx = anim.endX - anim.startX;
      const dy = anim.endY - anim.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Control point offset perpendicular to the line, proportional to distance
      const cpX = midX - (dy / dist) * dist * 0.3;
      const cpY = midY + (dx / dist) * dist * 0.3;

      // Evaluate bezier at parameter t
      const x = (1 - t) * (1 - t) * anim.startX + 2 * (1 - t) * t * cpX + t * t * anim.endX;
      const y = (1 - t) * (1 - t) * anim.startY + 2 * (1 - t) * t * cpY + t * t * anim.endY;

      const g = new Graphics();
      this.layers.overlay.addChild(g);

      // Draw the traveling agent dot
      g.circle(x, y, 6);
      g.fill({ color: anim.agentColor as ColorSource, alpha: 0.9 });
      // Glow
      g.circle(x, y, 10);
      g.fill({ color: anim.agentColor as ColorSource, alpha: 0.3 });
    }
  }

  // Compute a point on a quadratic bezier arc (for external use / testing)
  static bezierPoint(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    t: number,
  ): { x: number; y: number } {
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2;
    const dx = endX - startX;
    const dy = endY - startY;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const cpX = midX - (dy / dist) * dist * 0.3;
    const cpY = midY + (dx / dist) * dist * 0.3;

    return {
      x: (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * cpX + t * t * endX,
      y: (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * cpY + t * t * endY,
    };
  }
}
