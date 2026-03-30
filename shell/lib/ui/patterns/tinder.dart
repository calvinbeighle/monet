import 'package:flutter/material.dart';

class TinderCard {
  final String title;
  final String body;
  final Map<String, dynamic> metadata;

  TinderCard({
    required this.title,
    required this.body,
    this.metadata = const {},
  });
}

class TinderPattern extends StatefulWidget {
  final List<TinderCard> cards;
  final void Function(int index, bool approved)? onDecision;

  const TinderPattern({
    super.key,
    required this.cards,
    this.onDecision,
  });

  @override
  State<TinderPattern> createState() => TinderPatternState();
}

class TinderPatternState extends State<TinderPattern>
    with SingleTickerProviderStateMixin {
  int _currentIndex = 0;
  Offset _dragOffset = Offset.zero;
  final List<bool> _decisions = [];
  late AnimationController _animController;
  late Animation<Offset> _returnAnimation;
  bool _animating = false;

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 300),
    );
    _returnAnimation = Tween<Offset>(
      begin: Offset.zero,
      end: Offset.zero,
    ).animate(CurvedAnimation(
      parent: _animController,
      curve: Curves.easeOutBack,
    ));
    _animController.addListener(() {
      setState(() {
        _dragOffset = _returnAnimation.value;
      });
    });
  }

  @override
  void dispose() {
    _animController.dispose();
    super.dispose();
  }

  bool get _isComplete => _currentIndex >= widget.cards.length;

  int get approvedCount => _decisions.where((d) => d).length;
  int get rejectedCount => _decisions.where((d) => !d).length;

  void _onPanUpdate(DragUpdateDetails details) {
    if (_animating) return;
    setState(() {
      _dragOffset += details.delta;
    });
  }

  void _onPanEnd(DragEndDetails details) {
    if (_animating) return;
    if (_dragOffset.dx > 100) {
      _swipeOff(true);
    } else if (_dragOffset.dx < -100) {
      _swipeOff(false);
    } else {
      _springBack();
    }
  }

  void _swipeOff(bool approved) {
    _animating = true;
    final targetX = approved ? 500.0 : -500.0;
    _returnAnimation = Tween<Offset>(
      begin: _dragOffset,
      end: Offset(targetX, _dragOffset.dy),
    ).animate(CurvedAnimation(
      parent: _animController,
      curve: Curves.easeOut,
    ));
    _animController.forward(from: 0).then((_) {
      setState(() {
        _decisions.add(approved);
        widget.onDecision?.call(_currentIndex, approved);
        _currentIndex++;
        _dragOffset = Offset.zero;
        _animating = false;
      });
    });
  }

  void _springBack() {
    _animating = true;
    _returnAnimation = Tween<Offset>(
      begin: _dragOffset,
      end: Offset.zero,
    ).animate(CurvedAnimation(
      parent: _animController,
      curve: Curves.easeOutBack,
    ));
    _animController.forward(from: 0).then((_) {
      _animating = false;
    });
  }

  void undo() {
    if (_currentIndex > 0 && !_animating) {
      setState(() {
        _currentIndex--;
        _decisions.removeLast();
        _dragOffset = Offset.zero;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isComplete) {
      return _buildSummary();
    }
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            '${_currentIndex + 1} of ${widget.cards.length}',
            style: const TextStyle(
              color: Colors.white70,
              fontSize: 14,
            ),
          ),
        ),
        Expanded(
          child: Center(
            child: _buildCardStack(),
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              IconButton(
                onPressed: _currentIndex > 0 ? undo : null,
                icon: const Icon(Icons.undo),
                color: Colors.white70,
                disabledColor: Colors.white24,
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildCardStack() {
    final List<Widget> stack = [];

    // Show next card behind current
    if (_currentIndex + 1 < widget.cards.length) {
      stack.add(
        _buildCard(widget.cards[_currentIndex + 1], behind: true),
      );
    }

    // Current card with drag
    if (_currentIndex < widget.cards.length) {
      stack.add(
        GestureDetector(
          onPanUpdate: _onPanUpdate,
          onPanEnd: _onPanEnd,
          child: Transform.translate(
            offset: _dragOffset,
            child: Transform.rotate(
              angle: _dragOffset.dx * 0.001,
              child: _buildCard(
                widget.cards[_currentIndex],
                dragOffset: _dragOffset,
              ),
            ),
          ),
        ),
      );
    }

    return Stack(
      alignment: Alignment.center,
      children: stack,
    );
  }

  Widget _buildCard(TinderCard card, {
    bool behind = false,
    Offset dragOffset = Offset.zero,
  }) {
    final swipeProgress = (dragOffset.dx / 100).clamp(-1.0, 1.0);
    Color? overlayColor;
    if (swipeProgress > 0.2) {
      overlayColor = Colors.green.withValues(alpha: swipeProgress * 0.3);
    } else if (swipeProgress < -0.2) {
      overlayColor = Colors.red.withValues(alpha: -swipeProgress * 0.3);
    }

    return AnimatedScale(
      scale: behind ? 0.95 : 1.0,
      duration: const Duration(milliseconds: 200),
      child: Container(
        width: 340,
        height: 420,
        decoration: BoxDecoration(
          color: const Color(0xFF12121A),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: overlayColor ?? Colors.white10,
            width: overlayColor != null ? 2 : 1,
          ),
        ),
        child: Stack(
          children: [
            Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    card.title,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 20,
                      fontWeight: FontWeight.w600,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 16),
                  Expanded(
                    child: SingleChildScrollView(
                      child: Text(
                        card.body,
                        style: const TextStyle(
                          color: Colors.white70,
                          fontSize: 15,
                          height: 1.5,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            if (overlayColor != null)
              Positioned(
                top: 20,
                left: swipeProgress > 0 ? null : 20,
                right: swipeProgress > 0 ? 20 : null,
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    border: Border.all(
                      color: swipeProgress > 0 ? Colors.green : Colors.red,
                      width: 2,
                    ),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    swipeProgress > 0 ? 'APPROVE' : 'REJECT',
                    style: TextStyle(
                      color: swipeProgress > 0 ? Colors.green : Colors.red,
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildSummary() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(
            Icons.check_circle_outline,
            color: Colors.white70,
            size: 64,
          ),
          const SizedBox(height: 24),
          const Text(
            'All done',
            style: TextStyle(
              color: Colors.white,
              fontSize: 24,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _buildCountBadge(
                Icons.check,
                Colors.green,
                approvedCount,
                'approved',
              ),
              const SizedBox(width: 32),
              _buildCountBadge(
                Icons.close,
                Colors.red,
                rejectedCount,
                'rejected',
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildCountBadge(
      IconData icon, Color color, int count, String label) {
    return Column(
      children: [
        Icon(icon, color: color, size: 32),
        const SizedBox(height: 8),
        Text(
          '$count',
          style: TextStyle(
            color: color,
            fontSize: 28,
            fontWeight: FontWeight.bold,
          ),
        ),
        Text(
          label,
          style: const TextStyle(
            color: Colors.white54,
            fontSize: 14,
          ),
        ),
      ],
    );
  }
}
