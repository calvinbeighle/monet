// Map rendering engine per Spec 02
// PixiJS-based WebGL renderer with layer system:
//   Background (zones) -> Mid (connections) -> Foreground (threads/clusters) -> Overlay (agents, UI)

import { Application, Container, Graphics, Text, TextStyle, type ColorSource } from "pixi.js";
import type { Thread, Zone, ZoneId } from "../../lib/types";

// Visual constants
const THREAD_BASE_RADIUS = 8;
const THREAD_VALUE_SCALE = 2.0; // value score multiplier for radius
const URGENCY_PULSE_BASE_RATE = 0.5; // base pulse frequency in Hz
const URGENCY_PULSE_MAX_RATE = 3.0;
const AGE_OPACITY_DECAY_DAYS = 30; // thread fully faded after this many days

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
  // Selection ring rendered inline in renderThreads

  // Camera state
  private cameraX = 0;
  private cameraY = 0;
  private cameraZoom = 0.5; // start zoomed out to see whole map

  // Selection and search state (set by viewport, used during render)
  private selectedThreadId: string | null = null;
  private searchHighlightIds: Set<string> = new Set();
  private searchActive = false;

  // Animation state
  private pulseTime = 0;
  private zoomAnimationTarget: { x: number; y: number; zoom: number } | null = null;
  private zoomAnimationSpeed = 0.08; // fraction per frame

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

      // Zone border
      g.rect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
      g.stroke({ color: zone.borderColor as ColorSource, width: 2, alpha: 0.5 });

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
      label.text = `${zone.name} (${zone.threadCount})`;
      label.position.set((b.minX + b.maxX) / 2 - label.width / 2, b.minY + 10);
    }
  }

  // Render thread entities on foreground layer
  renderThreads(threads: Thread[], now: number = Date.now()): void {
    if (!this.layers) return;

    const activeIds = new Set(threads.map((t) => t.id));

    // Remove graphics for threads that no longer exist
    for (const [id, g] of this.threadGraphics) {
      if (!activeIds.has(id)) {
        g.destroy();
        this.threadGraphics.delete(id);
        const label = this.threadLabels.get(id);
        if (label) {
          label.destroy();
          this.threadLabels.delete(id);
        }
      }
    }

    const zoomLevel = this.getZoomLevel();

    for (const thread of threads) {
      let g = this.threadGraphics.get(thread.id);
      if (!g) {
        g = new Graphics();
        this.layers.foreground.addChild(g);
        this.threadGraphics.set(thread.id, g);
      }

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

      // Urgency pulse per Spec 02
      const pulseRate =
        URGENCY_PULSE_BASE_RATE +
        thread.urgencyScore * (URGENCY_PULSE_MAX_RATE - URGENCY_PULSE_BASE_RATE);
      const pulse =
        1.0 + Math.sin(this.pulseTime * pulseRate * Math.PI * 2) * 0.15 * thread.urgencyScore;

      // Draw the thread entity
      const r = radius * pulse;

      // Glow for high urgency
      if (thread.urgencyScore > 0.5) {
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
          label = new Text({
            text: "",
            style: new TextStyle({
              fontFamily: "Inter, system-ui, sans-serif",
              fontSize: 11,
              fill: 0xcccccc,
              wordWrap: true,
              wordWrapWidth: 120,
            }),
          });
          this.layers.foreground.addChild(label);
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

  private getUrgencyColor(urgency: number): number {
    // Gradient from cool blue (low urgency) to hot red (high urgency)
    if (urgency < 0.25) return 0x4488cc; // blue
    if (urgency < 0.5) return 0x66aa44; // green
    if (urgency < 0.75) return 0xddaa22; // amber
    return 0xdd3333; // red
  }

  private onTick(deltaMS: number): void {
    this.pulseTime += deltaMS / 1000;

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

  setSearchHighlight(ids: string[], active: boolean): void {
    this.searchHighlightIds = new Set(ids);
    this.searchActive = active;
  }

  getScreenWidth(): number {
    return this.app?.screen.width ?? 0;
  }

  getScreenHeight(): number {
    return this.app?.screen.height ?? 0;
  }
}
