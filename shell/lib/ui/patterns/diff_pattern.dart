/// diff_pattern.dart
///
/// Side-by-side code diff UI pattern. Shows original content on the left
/// and proposed changes on the right. Additions are highlighted in green,
/// deletions in red. Both panels scroll in sync.

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../services/session_provider.dart';
import '../../models/session.dart';

/// Side-by-side diff viewer UI pattern.
class DiffPattern extends StatefulWidget {
  const DiffPattern({super.key});

  @override
  State<DiffPattern> createState() => _DiffPatternState();
}

class _DiffPatternState extends State<DiffPattern> {
  final ScrollController _leftController = ScrollController();
  final ScrollController _rightController = ScrollController();
  bool _isSyncing = false;

  @override
  void initState() {
    super.initState();
    _leftController.addListener(_syncFromLeft);
    _rightController.addListener(_syncFromRight);
  }

  @override
  void dispose() {
    _leftController.dispose();
    _rightController.dispose();
    super.dispose();
  }

  /// Syncs right scroll position when left panel scrolls.
  void _syncFromLeft() {
    if (_isSyncing) return;
    if (!_rightController.hasClients) return;
    _isSyncing = true;
    _rightController.jumpTo(_leftController.offset);
    _isSyncing = false;
  }

  /// Syncs left scroll position when right panel scrolls.
  void _syncFromRight() {
    if (_isSyncing) return;
    if (!_leftController.hasClients) return;
    _isSyncing = true;
    _leftController.jumpTo(_rightController.offset);
    _isSyncing = false;
  }

  @override
  Widget build(BuildContext context) {
    final sessionProvider = context.watch<SessionProvider>();
    final diff = sessionProvider.session.diff;
    final isStreaming =
        sessionProvider.session.status == SessionStatus.streaming;

    if (diff == null) {
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
                    'Loading diff...',
                    style: TextStyle(color: Color(0xFF555555), fontSize: 13),
                  ),
                ],
              )
            : const Text(
                'No diff to display',
                style: TextStyle(color: Color(0xFF555555), fontSize: 13),
              ),
      );
    }

    return Column(
      children: [
        // Optional label header
        if (diff.label != null)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
            color: const Color(0xFF111111),
            child: Text(
              diff.label!,
              style: const TextStyle(
                color: Color(0xFF888888),
                fontSize: 12,
                fontFamily: 'monospace',
              ),
            ),
          ),

        // Panel headers
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Row(
            children: [
              Expanded(
                child: _PanelHeader(label: 'Original', isLeft: true),
              ),
              const SizedBox(width: 2),
              Expanded(
                child: _PanelHeader(label: 'Proposed', isLeft: false),
              ),
            ],
          ),
        ),

        // Side-by-side panels
        Expanded(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 0, 24, 16),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: _DiffPanel(
                    content: diff.original,
                    scrollController: _leftController,
                    isProposed: false,
                  ),
                ),
                const SizedBox(width: 2),
                Expanded(
                  child: _DiffPanel(
                    content: diff.proposed,
                    scrollController: _rightController,
                    isProposed: true,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Header label for each diff panel.
class _PanelHeader extends StatelessWidget {
  final String label;
  final bool isLeft;

  const _PanelHeader({required this.label, required this.isLeft});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(isLeft ? 8 : 0),
          topRight: Radius.circular(isLeft ? 0 : 8),
        ),
        border: const Border(
          bottom: BorderSide(color: Color(0xFF2A2A2A), width: 1),
        ),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: isLeft ? const Color(0xFF888888) : const Color(0xFF6366F1),
          fontSize: 11,
          fontFamily: 'monospace',
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

/// Scrollable text panel for one side of the diff.
class _DiffPanel extends StatelessWidget {
  final String content;
  final ScrollController scrollController;
  final bool isProposed;

  const _DiffPanel({
    required this.content,
    required this.scrollController,
    required this.isProposed,
  });

  @override
  Widget build(BuildContext context) {
    final lines = content.split('\n');

    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF0F0F0F),
        border: Border.all(color: const Color(0xFF2A2A2A), width: 1),
      ),
      child: ListView.builder(
        controller: scrollController,
        itemCount: lines.length,
        itemBuilder: (context, index) {
          final line = lines[index];
          final isAddition = isProposed && line.startsWith('+');
          final isDeletion = !isProposed && line.startsWith('-');

          return Container(
            color: isAddition
                ? const Color(0xFF22C55E).withOpacity(0.08)
                : isDeletion
                    ? const Color(0xFFEF4444).withOpacity(0.08)
                    : null,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 1),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Line number
                SizedBox(
                  width: 36,
                  child: Text(
                    '${index + 1}',
                    style: const TextStyle(
                      color: Color(0xFF444444),
                      fontSize: 12,
                      fontFamily: 'monospace',
                    ),
                  ),
                ),
                // Content
                Expanded(
                  child: Text(
                    line,
                    style: TextStyle(
                      color: isAddition
                          ? const Color(0xFF86EFAC)
                          : isDeletion
                              ? const Color(0xFFFCA5A5)
                              : const Color(0xFFD4D4D4),
                      fontSize: 13,
                      fontFamily: 'monospace',
                      height: 1.6,
                    ),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
