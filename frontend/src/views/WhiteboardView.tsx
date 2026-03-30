/**
 * views/WhiteboardView.tsx
 * Interactive planning canvas / whiteboard view for Monet.
 *
 * Features:
 * - Infinite canvas with pan (drag empty space) and zoom (scroll wheel)
 * - Draggable nodes (zinc-900 cards with rounded-xl borders)
 * - SVG curved connections between nodes
 * - Dot-grid background (subtle dots every 24px)
 * - "Add Node" button creates a new node near the center
 * - Starts with mock sprint-plan nodes
 *
 * All positioning is in canvas-space coordinates.
 * A CSS transform on the canvas container converts them to screen space.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A node on the whiteboard canvas */
interface WhiteboardNode {
  id: string;
  title: string;
  /** Canvas-space X position (top-left of node) */
  x: number;
  /** Canvas-space Y position (top-left of node) */
  y: number;
  /** Optional subtitle / description shown below the title */
  subtitle?: string;
}

/** A directed edge connecting two nodes by their IDs */
interface WhiteboardEdge {
  from: string;
  to: string;
}

/** Canvas pan/zoom state */
interface CanvasTransform {
  x: number;
  y: number;
  scale: number;
}

// ---------------------------------------------------------------------------
// Mock data - sample sprint plan
// ---------------------------------------------------------------------------

/** Node dimensions (fixed, no resize needed for now) */
const NODE_WIDTH = 160;
const NODE_HEIGHT = 64;

const INITIAL_NODES: WhiteboardNode[] = [
  { id: 'n1', title: 'Sprint Planning', subtitle: 'Define scope', x: 80, y: 80 },
  { id: 'n2', title: 'Auth Refactor', subtitle: 'PR #47', x: 320, y: 60 },
  { id: 'n3', title: 'API Rate Limiting', subtitle: 'In progress', x: 560, y: 60 },
  { id: 'n4', title: 'Email Agent', subtitle: 'Idle', x: 200, y: 240 },
  { id: 'n5', title: 'Dashboard UI', subtitle: 'Blocked', x: 440, y: 240 },
  { id: 'n6', title: 'Deploy', subtitle: 'Pending review', x: 320, y: 400 },
];

const INITIAL_EDGES: WhiteboardEdge[] = [
  { from: 'n1', to: 'n2' },
  { from: 'n1', to: 'n4' },
  { from: 'n2', to: 'n3' },
  { from: 'n4', to: 'n5' },
  { from: 'n2', to: 'n6' },
  { from: 'n5', to: 'n6' },
];

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Returns the center point of a node (in canvas space).
 *
 * @param node - The node to get the center of
 * @returns { cx, cy } center coordinates
 */
function nodeCenter(node: WhiteboardNode): { cx: number; cy: number } {
  return {
    cx: node.x + NODE_WIDTH / 2,
    cy: node.y + NODE_HEIGHT / 2,
  };
}

/**
 * Generates an SVG cubic-bezier path string for a curved connection
 * between two canvas-space points. Control points are offset vertically
 * to create a smooth arc.
 *
 * @param x1 - Start X
 * @param y1 - Start Y
 * @param x2 - End X
 * @param y2 - End Y
 * @returns SVG path 'd' attribute string
 */
function curvePath(x1: number, y1: number, x2: number, y2: number): string {
  const dy = Math.abs(y2 - y1);
  const cp = Math.max(40, dy * 0.5);
  return `M ${x1} ${y1} C ${x1} ${y1 + cp} ${x2} ${y2 - cp} ${x2} ${y2}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface NodeCardProps {
  node: WhiteboardNode;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  isDragging: boolean;
}

/**
 * Renders a single whiteboard node as a zinc-900 card.
 * Cursor changes to grabbing while dragging.
 */
function NodeCard({ node, onMouseDown, isDragging }: NodeCardProps) {
  return (
    <div
      onMouseDown={(e) => onMouseDown(e, node.id)}
      style={{
        position: 'absolute',
        left: node.x,
        top: node.y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        border: '1px solid rgba(255,255,255,0.1)',
      }}
      className="rounded-xl bg-zinc-900 flex flex-col items-center justify-center px-3 shadow-[0_4px_16px_rgba(0,0,0,0.5)] transition-shadow hover:shadow-[0_6px_24px_rgba(0,0,0,0.6)]"
    >
      <span className="text-[13px] font-medium text-zinc-100 text-center leading-tight truncate w-full text-center">
        {node.title}
      </span>
      {node.subtitle && (
        <span className="text-[11px] text-zinc-500 mt-0.5 truncate w-full text-center">
          {node.subtitle}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

/**
 * Interactive whiteboard canvas view.
 *
 * Pan by dragging empty canvas space, zoom with the scroll wheel.
 * Nodes are individually draggable. SVG edges connect nodes with curves.
 * "Add Node" appends a new card near the current viewport center.
 */
export function WhiteboardView() {
  const { setOverlayView } = useAppStore();

  const [nodes, setNodes] = useState<WhiteboardNode[]>(INITIAL_NODES);
  const [edges] = useState<WhiteboardEdge[]>(INITIAL_EDGES);

  /** Current canvas pan and zoom */
  const [transform, setTransform] = useState<CanvasTransform>({ x: 40, y: 40, scale: 1 });

  /** ID of the node currently being dragged, or null */
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);

  /** True when panning the canvas (dragging empty space) */
  const [isPanning, setIsPanning] = useState(false);

  /** Counter for generating unique node IDs */
  const nodeCounter = useRef(INITIAL_NODES.length + 1);

  /** Last mouse position for computing delta during drag/pan */
  const lastMouse = useRef<{ x: number; y: number } | null>(null);

  /** Ref to the outer container for bounds */
  const containerRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------------------
  // Node drag handlers
  // ---------------------------------------------------------------------------

  /**
   * Initiates a node drag on mousedown over a node card.
   * Stops propagation so the canvas pan handler does not also fire.
   */
  const handleNodeMouseDown = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      e.preventDefault();
      setDraggingNodeId(id);
      lastMouse.current = { x: e.clientX, y: e.clientY };
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Canvas pan handler
  // ---------------------------------------------------------------------------

  /**
   * Initiates a canvas pan on mousedown over empty canvas space.
   */
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    setIsPanning(true);
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);

  // ---------------------------------------------------------------------------
  // Global mousemove / mouseup
  // ---------------------------------------------------------------------------

  useEffect(() => {
    /**
     * Handles mouse movement for both node dragging and canvas panning.
     * Converts screen-space delta to canvas-space delta for node positions.
     */
    function onMouseMove(e: MouseEvent) {
      if (!lastMouse.current) return;

      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      lastMouse.current = { x: e.clientX, y: e.clientY };

      if (draggingNodeId) {
        // Move node: screen delta divided by scale = canvas delta
        setNodes((prev) =>
          prev.map((n) =>
            n.id === draggingNodeId
              ? { ...n, x: n.x + dx / transform.scale, y: n.y + dy / transform.scale }
              : n
          )
        );
        return;
      }

      if (isPanning) {
        setTransform((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      }
    }

    /** Clears drag/pan state on mouse release. */
    function onMouseUp() {
      setDraggingNodeId(null);
      setIsPanning(false);
      lastMouse.current = null;
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [draggingNodeId, isPanning, transform.scale]);

  // ---------------------------------------------------------------------------
  // Scroll to zoom
  // ---------------------------------------------------------------------------

  /**
   * Zooms the canvas centered on the cursor position using the scroll wheel.
   * Clamps scale between 0.25x and 3x.
   */
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.93;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    setTransform((prev) => {
      const newScale = Math.min(3, Math.max(0.25, prev.scale * zoomFactor));
      const scaleDelta = newScale / prev.scale;
      return {
        scale: newScale,
        x: mouseX - (mouseX - prev.x) * scaleDelta,
        y: mouseY - (mouseY - prev.y) * scaleDelta,
      };
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Add node
  // ---------------------------------------------------------------------------

  /**
   * Adds a new blank node near the visible center of the canvas.
   * Converts viewport center to canvas space using the current transform.
   */
  function handleAddNode() {
    const rect = containerRef.current?.getBoundingClientRect();
    const vpCx = rect ? rect.width / 2 : 400;
    const vpCy = rect ? rect.height / 2 : 300;

    // Canvas space = (screen - pan) / scale
    const cx = (vpCx - transform.x) / transform.scale;
    const cy = (vpCy - transform.y) / transform.scale;

    const id = `n${nodeCounter.current++}`;
    setNodes((prev) => [
      ...prev,
      {
        id,
        title: 'New Node',
        subtitle: 'Click to edit',
        x: cx - NODE_WIDTH / 2,
        y: cy - NODE_HEIGHT / 2,
      },
    ]);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  /** Look up a node by ID - throws if not found */
  function getNode(id: string): WhiteboardNode {
    const node = nodes.find((n) => n.id === id);
    if (!node) throw new Error(`Node ${id} not found`);
    return node;
  }

  const canvasTransformStyle = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;

  return (
    <div className="flex flex-col w-full h-full bg-black overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 shrink-0">
        <button
          onClick={() => setOverlayView(null)}
          className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <ArrowLeft size={16} />
          Back
        </button>

        <button
          onClick={handleAddNode}
          className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 rounded-lg px-3 py-1.5 transition-colors"
        >
          <Plus size={14} />
          Add Node
        </button>
      </div>

      {/* Divider */}
      <div className="h-px mx-6 shrink-0" style={{ background: 'rgba(255,255,255,0.06)' }} />

      {/* Canvas container */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden"
        style={{
          cursor: isPanning ? 'grabbing' : 'default',
          background: '#000',
          // Dot-grid background via CSS radial-gradient
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.12) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
        onMouseDown={handleCanvasMouseDown}
        onWheel={handleWheel}
      >
        {/* Transformed canvas layer */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            transformOrigin: '0 0',
            transform: canvasTransformStyle,
            // Large explicit size so SVG fills enough area
            width: 2400,
            height: 2400,
          }}
        >
          {/* SVG edge layer - rendered behind nodes */}
          <svg
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}
          >
            <defs>
              <marker
                id="arrowhead"
                markerWidth="8"
                markerHeight="8"
                refX="6"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L0,6 L8,3 z" fill="rgba(255,255,255,0.18)" />
              </marker>
            </defs>

            {edges.map((edge, idx) => {
              let fromNode: WhiteboardNode | undefined;
              let toNode: WhiteboardNode | undefined;
              try {
                fromNode = getNode(edge.from);
                toNode = getNode(edge.to);
              } catch {
                return null;
              }
              const { cx: x1, cy: y1 } = nodeCenter(fromNode);
              const { cx: x2, cy: y2 } = nodeCenter(toNode);
              const d = curvePath(x1, y1, x2, y2);

              return (
                <path
                  key={idx}
                  d={d}
                  fill="none"
                  stroke="rgba(255,255,255,0.14)"
                  strokeWidth={1.5}
                  markerEnd="url(#arrowhead)"
                />
              );
            })}
          </svg>

          {/* Node cards */}
          {nodes.map((node) => (
            <NodeCard
              key={node.id}
              node={node}
              onMouseDown={handleNodeMouseDown}
              isDragging={draggingNodeId === node.id}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
