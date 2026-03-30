/// tinder_pattern.dart
///
/// Swipeable card stack UI pattern for batch decisions. The agent places
/// decision cards on the stack. The user swipes right to approve or left
/// to reject each card. Cards animate off-screen on dismissal.

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../services/session_provider.dart';
import '../../models/session.dart';

/// Tinder-style swipeable decision card stack.
class TinderPattern extends StatelessWidget {
  const TinderPattern({super.key});

  @override
  Widget build(BuildContext context) {
    final sessionProvider = context.watch<SessionProvider>();
    final cards = sessionProvider.session.cards;
    final isStreaming =
        sessionProvider.session.status == SessionStatus.streaming;

    if (cards.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (isStreaming) ...[
              const SizedBox(
                width: 32,
                height: 32,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: Color(0xFF6366F1),
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                'Loading decisions...',
                style: TextStyle(color: Color(0xFF555555), fontSize: 13),
              ),
            ] else ...[
              const Icon(
                Icons.check_circle_outline,
                size: 48,
                color: Color(0xFF333333),
              ),
              const SizedBox(height: 12),
              const Text(
                'All decisions resolved',
                style: TextStyle(color: Color(0xFF555555), fontSize: 13),
              ),
            ],
          ],
        ),
      );
    }

    return Center(
      child: SizedBox(
        width: 480,
        height: 400,
        child: Stack(
          alignment: Alignment.center,
          children: [
            // Background cards (decorative stack effect)
            for (var i = cards.length - 1; i >= 0 && i >= cards.length - 3; i--)
              if (i != cards.length - 1)
                Positioned(
                  top: (cards.length - 1 - i).toDouble() * 6,
                  child: Transform.scale(
                    scale: 1.0 - (cards.length - 1 - i) * 0.04,
                    child: _CardShell(card: cards[i], isInteractive: false),
                  ),
                ),

            // Top card - interactive
            _DraggableCard(
              key: ValueKey(cards.last.id),
              card: cards.last,
              onDismiss: (approved) =>
                  sessionProvider.dismissCard(cards.last.id, approved: approved),
            ),
          ],
        ),
      ),
    );
  }
}

/// A card with drag-to-dismiss gesture support.
class _DraggableCard extends StatefulWidget {
  final DecisionCard card;
  final void Function(bool approved) onDismiss;

  const _DraggableCard({
    super.key,
    required this.card,
    required this.onDismiss,
  });

  @override
  State<_DraggableCard> createState() => _DraggableCardState();
}

class _DraggableCardState extends State<_DraggableCard>
    with SingleTickerProviderStateMixin {
  double _dragOffset = 0;
  bool _isDismissing = false;

  /// Returns the tilt angle based on drag position (-1.0 to 1.0 range).
  double get _tiltAngle => (_dragOffset / 400).clamp(-0.3, 0.3);

  /// Returns the action label based on drag direction.
  String? get _actionLabel {
    if (_dragOffset > 60) return 'APPROVE';
    if (_dragOffset < -60) return 'REJECT';
    return null;
  }

  Color? get _actionColor {
    if (_dragOffset > 60) return const Color(0xFF22C55E);
    if (_dragOffset < -60) return const Color(0xFFEF4444);
    return null;
  }

  void _handleDragUpdate(DragUpdateDetails details) {
    setState(() {
      _dragOffset += details.delta.dx;
    });
  }

  void _handleDragEnd(DragEndDetails details) {
    if (_dragOffset.abs() > 120 || details.velocity.pixelsPerSecond.dx.abs() > 600) {
      final approved = _dragOffset > 0;
      setState(() => _isDismissing = true);
      Future.delayed(const Duration(milliseconds: 200), () {
        widget.onDismiss(approved);
      });
    } else {
      setState(() => _dragOffset = 0);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedSlide(
      offset: _isDismissing
          ? Offset(_dragOffset > 0 ? 2.0 : -2.0, 0)
          : Offset.zero,
      duration: const Duration(milliseconds: 200),
      child: GestureDetector(
        onHorizontalDragUpdate: _handleDragUpdate,
        onHorizontalDragEnd: _handleDragEnd,
        child: Transform.translate(
          offset: Offset(_dragOffset, 0),
          child: Transform.rotate(
            angle: _tiltAngle,
            child: Stack(
              children: [
                _CardShell(card: widget.card, isInteractive: true),
                // Action label overlay
                if (_actionLabel != null)
                  Positioned.fill(
                    child: Container(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(16),
                        color: _actionColor!.withOpacity(0.15),
                        border: Border.all(
                          color: _actionColor!,
                          width: 2,
                        ),
                      ),
                      child: Center(
                        child: Text(
                          _actionLabel!,
                          style: TextStyle(
                            color: _actionColor,
                            fontSize: 28,
                            fontWeight: FontWeight.bold,
                            letterSpacing: 3,
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The visual card container (used for both interactive and stack cards).
class _CardShell extends StatelessWidget {
  final DecisionCard card;
  final bool isInteractive;

  const _CardShell({required this.card, required this.isInteractive});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 480,
      height: 380,
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: const Color(0xFF2A2A2A),
          width: 1,
        ),
        boxShadow: isInteractive
            ? [
                BoxShadow(
                  color: Colors.black.withOpacity(0.4),
                  blurRadius: 20,
                  offset: const Offset(0, 8),
                ),
              ]
            : null,
      ),
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Card title
            Text(
              card.title,
              style: const TextStyle(
                color: Color(0xFFE2E2E2),
                fontSize: 20,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 16),

            // Divider
            Container(
              height: 1,
              color: const Color(0xFF2A2A2A),
            ),
            const SizedBox(height: 16),

            // Card body
            Expanded(
              child: Text(
                card.body,
                style: const TextStyle(
                  color: Color(0xFFAAAAAA),
                  fontSize: 14,
                  height: 1.6,
                ),
              ),
            ),

            // Swipe hint
            if (isInteractive)
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: const [
                  Row(
                    children: [
                      Icon(Icons.arrow_back, size: 14, color: Color(0xFFEF4444)),
                      SizedBox(width: 4),
                      Text(
                        'Reject',
                        style: TextStyle(
                          color: Color(0xFF666666),
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                  Row(
                    children: [
                      Text(
                        'Approve',
                        style: TextStyle(
                          color: Color(0xFF666666),
                          fontSize: 11,
                        ),
                      ),
                      SizedBox(width: 4),
                      Icon(
                        Icons.arrow_forward,
                        size: 14,
                        color: Color(0xFF22C55E),
                      ),
                    ],
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}
