/// whiteboard_pattern.dart
///
/// Zoomable canvas UI pattern where the agent can place text nodes.
/// Users can drag nodes around the canvas and zoom/pan the entire view.
/// Built with Flutter's InteractiveViewer for free pan/zoom support.

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../services/session_provider.dart';
import '../../models/session.dart';

/// Zoomable whiteboard canvas with draggable agent-placed nodes.
class WhiteboardPattern extends StatelessWidget {
  const WhiteboardPattern({super.key});

  @override
  Widget build(BuildContext context) {
    final sessionProvider = context.watch<SessionProvider>();
    final nodes = sessionProvider.session.whiteboardNodes;
    final isStreaming =
        sessionProvider.session.status == SessionStatus.streaming;

    if (nodes.isEmpty) {
      return Center(
        child: isStreaming
            ? const Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  SizedBox(
                    width: 32,
                    height: 32,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Color(0xFF6366F1),
                    ),
                  ),
                  SizedBox(height: 16),
                  Text(
                    'Building whiteboard...',
                    style: TextStyle(color: Color(0xFF555555), fontSize: 13),
                  ),
                ],
              )
            : const Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.dashboard_outlined,
                    size: 48,
                    color: Color(0xFF333333),
                  ),
                  SizedBox(height: 12),
                  Text(
                    'Empty canvas',
                    style: TextStyle(color: Color(0xFF555555), fontSize: 13),
                  ),
                ],
              ),
      );
    }

    return ClipRect(
      child: InteractiveViewer(
        constrained: false,
        boundaryMargin: const EdgeInsets.all(200),
        minScale: 0.3,
        maxScale: 3.0,
        child: _WhiteboardCanvas(nodes: nodes),
      ),
    );
  }
}

/// The actual canvas area holding all draggable nodes.
class _WhiteboardCanvas extends StatelessWidget {
  final List<WhiteboardNode> nodes;

  const _WhiteboardCanvas({required this.nodes});

  @override
  Widget build(BuildContext context) {
    // Calculate bounding box for canvas size
    final maxX = nodes.fold<double>(
          0,
          (prev, n) => n.x > prev ? n.x : prev,
        ) +
        300;
    final maxY = nodes.fold<double>(
          0,
          (prev, n) => n.y > prev ? n.y : prev,
        ) +
        200;

    return SizedBox(
      width: maxX.clamp(1200, 4000),
      height: maxY.clamp(900, 3000),
      child: Stack(
        children: [
          // Dot grid background
          CustomPaint(
            size: Size(maxX.clamp(1200, 4000), maxY.clamp(900, 3000)),
            painter: _DotGridPainter(),
          ),

          // Nodes
          for (final node in nodes)
            Positioned(
              left: node.x,
              top: node.y,
              child: _DraggableNode(node: node),
            ),
        ],
      ),
    );
  }
}

/// A draggable text node on the whiteboard.
class _DraggableNode extends StatelessWidget {
  final WhiteboardNode node;

  const _DraggableNode({required this.node});

  @override
  Widget build(BuildContext context) {
    final sessionProvider = context.read<SessionProvider>();

    return GestureDetector(
      onPanUpdate: (details) {
        sessionProvider.moveNode(node.id, details.delta.dx, details.delta.dy);
      },
      child: Container(
        constraints: const BoxConstraints(
          minWidth: 160,
          maxWidth: 280,
        ),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: const Color(0xFF1A1A1A),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: const Color(0xFF2A2A2A),
            width: 1,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.3),
              blurRadius: 8,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            // Drag handle indicator
            Row(
              children: [
                Container(
                  width: 20,
                  height: 3,
                  decoration: BoxDecoration(
                    color: const Color(0xFF333333),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const Spacer(),
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: const Color(0xFF6366F1).withOpacity(0.5),
                    shape: BoxShape.circle,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),

            // Node content
            Text(
              node.content,
              style: const TextStyle(
                color: Color(0xFFD4D4D4),
                fontSize: 13,
                height: 1.5,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Paints a dot grid pattern for the whiteboard background.
class _DotGridPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = const Color(0xFF222222)
      ..strokeWidth = 1.5
      ..style = PaintingStyle.fill;

    const spacing = 32.0;
    const dotRadius = 1.0;

    for (double x = 0; x < size.width; x += spacing) {
      for (double y = 0; y < size.height; y += spacing) {
        canvas.drawCircle(Offset(x, y), dotRadius, paint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
