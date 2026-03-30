import 'package:flutter/material.dart';

enum DiffType { unchanged, added, removed, modified }

class DiffLine {
  final String? left;
  final String? right;
  final DiffType type;

  const DiffLine({
    this.left,
    this.right,
    this.type = DiffType.unchanged,
  });
}

class DiffPattern extends StatefulWidget {
  final List<DiffLine> lines;
  final String leftTitle;
  final String rightTitle;
  final void Function(bool approved)? onDecision;

  const DiffPattern({
    super.key,
    required this.lines,
    this.leftTitle = 'Original',
    this.rightTitle = 'Modified',
    this.onDecision,
  });

  @override
  State<DiffPattern> createState() => _DiffPatternState();
}

class _DiffPatternState extends State<DiffPattern> {
  final ScrollController _scrollController = ScrollController();

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  Color _leftBackground(DiffType type) {
    switch (type) {
      case DiffType.removed:
        return Colors.red.withValues(alpha: 0.1);
      case DiffType.modified:
        return Colors.red.withValues(alpha: 0.1);
      default:
        return Colors.transparent;
    }
  }

  Color _rightBackground(DiffType type) {
    switch (type) {
      case DiffType.added:
        return Colors.green.withValues(alpha: 0.1);
      case DiffType.modified:
        return Colors.green.withValues(alpha: 0.1);
      default:
        return Colors.transparent;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _buildHeader(),
        Expanded(child: _buildDiffView()),
        if (widget.onDecision != null) _buildActions(),
      ],
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFF12121A),
        border: Border(
          bottom: BorderSide(color: Colors.white.withValues(alpha: 0.1)),
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              widget.leftTitle,
              style: const TextStyle(
                color: Colors.white70,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          Container(
            width: 1,
            height: 20,
            color: Colors.white.withValues(alpha: 0.1),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(left: 16),
              child: Text(
                widget.rightTitle,
                style: const TextStyle(
                  color: Colors.white70,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDiffView() {
    return ListView.builder(
      controller: _scrollController,
      itemCount: widget.lines.length,
      itemBuilder: (context, index) {
        final line = widget.lines[index];
        return IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: Container(
                  color: _leftBackground(line.type),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
                  child: Text(
                    line.left ?? '',
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 13,
                      color: line.type == DiffType.removed ||
                              line.type == DiffType.modified
                          ? Colors.red.shade300
                          : Colors.white70,
                    ),
                  ),
                ),
              ),
              Container(
                width: 1,
                color: Colors.white.withValues(alpha: 0.05),
              ),
              Expanded(
                child: Container(
                  color: _rightBackground(line.type),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
                  child: Text(
                    line.right ?? '',
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 13,
                      color: line.type == DiffType.added ||
                              line.type == DiffType.modified
                          ? Colors.green.shade300
                          : Colors.white70,
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildActions() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF0A0A0F),
        border: Border(
          top: BorderSide(color: Colors.white.withValues(alpha: 0.1)),
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          OutlinedButton.icon(
            onPressed: () => widget.onDecision?.call(false),
            icon: const Icon(Icons.close, size: 18),
            label: const Text('Reject All'),
            style: OutlinedButton.styleFrom(
              foregroundColor: Colors.red.shade300,
              side: BorderSide(color: Colors.red.shade300.withValues(alpha: 0.5)),
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
            ),
          ),
          const SizedBox(width: 16),
          FilledButton.icon(
            onPressed: () => widget.onDecision?.call(true),
            icon: const Icon(Icons.check, size: 18),
            label: const Text('Approve All'),
            style: FilledButton.styleFrom(
              backgroundColor: Colors.green.shade700,
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
            ),
          ),
        ],
      ),
    );
  }
}
