/// intent_bar.dart
///
/// Persistent text input bar fixed at the bottom of the shell. The user
/// types their intent here and hits Enter (or the submit button) to send
/// it to the agent backend. Inspired by Spotlight / Raycast launchers.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../services/session_provider.dart';
import '../models/session.dart';

/// Height of the intent bar container.
const double kIntentBarHeight = 64.0;

/// Bottom-anchored intent input widget.
class IntentBar extends StatefulWidget {
  const IntentBar({super.key});

  @override
  State<IntentBar> createState() => _IntentBarState();
}

class _IntentBarState extends State<IntentBar> {
  final TextEditingController _controller = TextEditingController();
  final FocusNode _focusNode = FocusNode();

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  /// Submits the current text as a new intent.
  void _submit(SessionProvider provider) {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    _controller.clear();
    provider.submitIntent(text);
    _focusNode.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    final sessionProvider = context.watch<SessionProvider>();
    final isProcessing =
        sessionProvider.session.status == SessionStatus.connecting ||
        sessionProvider.session.status == SessionStatus.streaming;

    return Container(
      height: kIntentBarHeight,
      color: const Color(0xFF0D0D0D),
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 10),
      child: Row(
        children: [
          // Main text field
          Expanded(
            child: CallbackShortcuts(
              bindings: {
                const SingleActivator(LogicalKeyboardKey.escape): () {
                  if (sessionProvider.session.status != SessionStatus.idle) {
                    sessionProvider.resetSession();
                  }
                  _controller.clear();
                },
              },
              child: TextField(
                controller: _controller,
                focusNode: _focusNode,
                autofocus: true,
                enabled: !isProcessing,
                style: const TextStyle(
                  color: Color(0xFFE2E2E2),
                  fontSize: 15,
                  fontFamily: 'monospace',
                ),
                decoration: InputDecoration(
                  hintText: isProcessing
                      ? 'Agent is thinking...'
                      : 'What do you want to do?',
                  hintStyle: const TextStyle(
                    color: Color(0xFF555555),
                    fontSize: 15,
                  ),
                  filled: true,
                  fillColor: const Color(0xFF1A1A1A),
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 12,
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: BorderSide.none,
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(
                      color: Color(0xFF2A2A2A),
                      width: 1,
                    ),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(
                      color: Color(0xFF6366F1),
                      width: 1.5,
                    ),
                  ),
                  prefixIcon: isProcessing
                      ? const Padding(
                          padding: EdgeInsets.all(12),
                          child: SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Color(0xFF6366F1),
                            ),
                          ),
                        )
                      : const Icon(
                          Icons.terminal,
                          color: Color(0xFF555555),
                          size: 16,
                        ),
                ),
                onSubmitted: (_) => _submit(sessionProvider),
              ),
            ),
          ),

          const SizedBox(width: 10),

          // Submit / Cancel button
          _ActionButton(
            isProcessing: isProcessing,
            onSubmit: () => _submit(sessionProvider),
            onCancel: () {
              sessionProvider.resetSession();
              _focusNode.requestFocus();
            },
          ),
        ],
      ),
    );
  }
}

/// Small icon button that toggles between submit and cancel actions.
class _ActionButton extends StatelessWidget {
  final bool isProcessing;
  final VoidCallback onSubmit;
  final VoidCallback onCancel;

  const _ActionButton({
    required this.isProcessing,
    required this.onSubmit,
    required this.onCancel,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: isProcessing ? onCancel : onSubmit,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        width: 36,
        height: 36,
        decoration: BoxDecoration(
          color: isProcessing
              ? const Color(0xFF2A2A2A)
              : const Color(0xFF6366F1),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(
          isProcessing ? Icons.stop : Icons.arrow_forward,
          color: const Color(0xFFE2E2E2),
          size: 16,
        ),
      ),
    );
  }
}
