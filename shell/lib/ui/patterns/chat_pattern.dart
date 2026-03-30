/// chat_pattern.dart
///
/// iMessage-style threaded chat UI pattern. Displays the conversation
/// between the user and the agent with streaming support. Agent messages
/// appear on the left, user messages on the right.

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../services/session_provider.dart';
import '../../models/session.dart';

/// Chat message list UI pattern.
class ChatPattern extends StatefulWidget {
  const ChatPattern({super.key});

  @override
  State<ChatPattern> createState() => _ChatPatternState();
}

class _ChatPatternState extends State<ChatPattern> {
  final ScrollController _scrollController = ScrollController();

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  /// Scrolls the list to the bottom after the current frame renders.
  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 150),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final sessionProvider = context.watch<SessionProvider>();
    final messages = sessionProvider.session.messages;
    final isStreaming =
        sessionProvider.session.status == SessionStatus.streaming;

    // Auto-scroll when messages change
    _scrollToBottom();

    if (messages.isEmpty) {
      return const Center(
        child: Text(
          'Waiting for agent...',
          style: TextStyle(color: Color(0xFF555555), fontSize: 13),
        ),
      );
    }

    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.fromLTRB(24, 16, 24, 8),
      itemCount: messages.length,
      itemBuilder: (context, index) {
        final message = messages[index];
        final isLastMessage = index == messages.length - 1;
        final isStreamingThisMessage =
            isStreaming && isLastMessage && message.role == 'assistant';

        return Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: _MessageBubble(
            message: message,
            isStreaming: isStreamingThisMessage,
          ),
        );
      },
    );
  }
}

/// A single message bubble in the chat.
class _MessageBubble extends StatelessWidget {
  final ChatMessage message;
  final bool isStreaming;

  const _MessageBubble({
    required this.message,
    required this.isStreaming,
  });

  bool get _isUser => message.role == 'user';

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment:
          _isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        if (!_isUser) ...[
          // Agent avatar
          Container(
            width: 26,
            height: 26,
            margin: const EdgeInsets.only(right: 8, bottom: 2),
            decoration: BoxDecoration(
              color: const Color(0xFF6366F1).withOpacity(0.2),
              shape: BoxShape.circle,
              border: Border.all(
                color: const Color(0xFF6366F1).withOpacity(0.4),
                width: 1,
              ),
            ),
            child: const Icon(
              Icons.auto_awesome,
              size: 12,
              color: Color(0xFF6366F1),
            ),
          ),
        ],
        Flexible(
          child: Container(
            constraints: BoxConstraints(
              maxWidth: MediaQuery.of(context).size.width * 0.65,
            ),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: _isUser
                  ? const Color(0xFF6366F1)
                  : const Color(0xFF1E1E1E),
              borderRadius: BorderRadius.only(
                topLeft: const Radius.circular(14),
                topRight: const Radius.circular(14),
                bottomLeft: Radius.circular(_isUser ? 14 : 4),
                bottomRight: Radius.circular(_isUser ? 4 : 14),
              ),
              border: _isUser
                  ? null
                  : Border.all(
                      color: const Color(0xFF2A2A2A),
                      width: 1,
                    ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Flexible(
                  child: Text(
                    message.content,
                    style: TextStyle(
                      color: _isUser
                          ? const Color(0xFFFFFFFF)
                          : const Color(0xFFD4D4D4),
                      fontSize: 14,
                      height: 1.5,
                    ),
                  ),
                ),
                if (isStreaming) ...[
                  const SizedBox(width: 6),
                  _BlinkingCursor(),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Blinking text cursor shown while the agent is streaming.
class _BlinkingCursor extends StatefulWidget {
  @override
  State<_BlinkingCursor> createState() => _BlinkingCursorState();
}

class _BlinkingCursorState extends State<_BlinkingCursor>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    )..repeat(reverse: true);
    _animation = Tween<double>(begin: 0.0, end: 1.0).animate(_controller);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _animation,
      builder: (context, _) => Opacity(
        opacity: _animation.value,
        child: Container(
          width: 2,
          height: 14,
          color: const Color(0xFF6366F1),
        ),
      ),
    );
  }
}
