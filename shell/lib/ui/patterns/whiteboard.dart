import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../monet_theme.dart';

class WhiteboardNode {
  final String id;
  String title;
  String body;
  double x;
  double y;
  String priority;
  List<String> connections;

  WhiteboardNode({
    required this.id,
    required this.title,
    this.body = '',
    this.x = 0,
    this.y = 0,
    this.priority = 'medium',
    this.connections = const [],
  });

  static Color priorityColor(String priority, MonetColors c) {
    switch (priority) {
      case 'high':
        return c.error;
      case 'low':
        return c.success;
      default:
        return c.primary;
    }
  }
}

class WhiteboardPattern extends StatefulWidget {
  final List<WhiteboardNode> nodes;
  final void Function(String nodeId)? onNodeTap;
  final void Function(String nodeId, double x, double y)? onNodeMoved;

  const WhiteboardPattern({
    super.key,
    required this.nodes,
    this.onNodeTap,
    this.onNodeMoved,
  });

  @override
  State<WhiteboardPattern> createState() => WhiteboardPatternState();
}

class WhiteboardPatternState extends State<WhiteboardPattern> {
  final TransformationController _transformController =
      TransformationController();
  String? _draggingNodeId;

  @override
  void dispose() {
    _transformController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = MonetColors.of(context);
    return InteractiveViewer(
      transformationController: _transformController,
      minScale: 0.3,
      maxScale: 3.0,
      boundaryMargin: const EdgeInsets.all(500),
      child: SizedBox(
        width: 3000,
        height: 3000,
        child: Stack(
          children: [
            CustomPaint(
              size: const Size(3000, 3000),
              painter: _ConnectionPainter(nodes: widget.nodes, borderColor: c.border),
            ),
            ...widget.nodes.asMap().entries.map((entry) => _buildNode(entry.value, c, index: entry.key)),
          ],
        ),
      ),
    );
  }

  Widget _buildNode(WhiteboardNode node, MonetColors c, {int index = 0}) {
    return Positioned(
      left: node.x,
      top: node.y,
      child: GestureDetector(
        onTap: () => widget.onNodeTap?.call(node.id),
        onPanStart: (_) => _draggingNodeId = node.id,
        onPanUpdate: (details) {
          if (_draggingNodeId != node.id) return;
          // Convert screen delta to canvas delta by accounting for zoom
          final scale = _transformController.value.getMaxScaleOnAxis();
          setState(() {
            node.x += details.delta.dx / scale;
            node.y += details.delta.dy / scale;
          });
        },
        onPanEnd: (_) {
          if (_draggingNodeId == node.id) {
            widget.onNodeMoved?.call(node.id, node.x, node.y);
            _draggingNodeId = null;
          }
        },
        child: Container(
          width: 200,
          constraints: const BoxConstraints(minHeight: 60),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: c.surface,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: WhiteboardNode.priorityColor(node.priority, c).withValues(alpha: 0.5),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: WhiteboardNode.priorityColor(node.priority, c),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      node.title,
                      style: TextStyle(
                        color: c.textPrimary,
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              if (node.body.isNotEmpty) ...[
                const SizedBox(height: 6),
                Text(
                  node.body,
                  style: TextStyle(
                    color: c.textTertiary,
                    fontSize: 12,
                    height: 1.4,
                  ),
                  maxLines: 4,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ],
          ),
        )
            .animate(delay: Duration(milliseconds: 60 * index))
            .fadeIn(duration: 350.ms, curve: Curves.easeOut)
            .scale(begin: const Offset(0.8, 0.8), end: const Offset(1, 1), duration: 400.ms, curve: Curves.easeOutBack),
      ),
    );
  }
}

class _ConnectionPainter extends CustomPainter {
  final List<WhiteboardNode> nodes;
  final Color borderColor;

  _ConnectionPainter({required this.nodes, required this.borderColor});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = borderColor
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke;

    final nodeMap = <String, WhiteboardNode>{};
    for (final node in nodes) {
      nodeMap[node.id] = node;
    }

    for (final node in nodes) {
      final fromCenter = Offset(node.x + 100, node.y + 30);
      for (final targetId in node.connections) {
        final target = nodeMap[targetId];
        if (target != null) {
          final toCenter = Offset(target.x + 100, target.y + 30);
          canvas.drawLine(fromCenter, toCenter, paint);
        }
      }
    }
  }

  @override
  bool shouldRepaint(_ConnectionPainter oldDelegate) {
    if (nodes.length != oldDelegate.nodes.length) return true;
    for (int i = 0; i < nodes.length; i++) {
      final a = nodes[i];
      final b = oldDelegate.nodes[i];
      if (a.id != b.id ||
          a.x != b.x ||
          a.y != b.y ||
          a.connections.length != b.connections.length) {
        return true;
      }
    }
    return false;
  }
}
