import 'package:flutter/material.dart';
import '../monet_theme.dart';
import '../voice_button.dart';

class ChatMessage {
  String content;
  final bool isUser;
  final bool isSystem;
  final bool isApproval;
  final bool isError;
  final bool isRetryable;
  final String? approvalId;
  final String? toolName;
  final Map<String, dynamic> approvalParameters;
  String approvalStatus; // 'pending', 'approved', 'rejected'
  final DateTime timestamp;
  final String? id;

  ChatMessage({
    required this.content,
    required this.isUser,
    this.isSystem = false,
    this.isApproval = false,
    this.isError = false,
    this.isRetryable = false,
    this.approvalId,
    this.toolName,
    this.approvalParameters = const {},
    this.approvalStatus = 'pending',
    DateTime? timestamp,
    this.id,
  }) : timestamp = timestamp ?? DateTime.now();
}

class ChatPattern extends StatefulWidget {
  final List<ChatMessage> messages;
  final List<String> suggestions;
  final bool isStreaming;
  final void Function(String message)? onSend;
  final void Function(String suggestion)? onSuggestionTap;
  final void Function(String approvalId, bool approved)? onApprovalDecision;
  final VoidCallback? onRetry;

  const ChatPattern({
    super.key,
    required this.messages,
    this.suggestions = const [],
    this.isStreaming = false,
    this.onSend,
    this.onSuggestionTap,
    this.onApprovalDecision,
    this.onRetry,
  });

  @override
  State<ChatPattern> createState() => ChatPatternState();
}

class ChatPatternState extends State<ChatPattern> {
  final TextEditingController _controller = TextEditingController();
  final ScrollController _scrollController = ScrollController();

  @override
  void dispose() {
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(ChatPattern oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.messages.length != oldWidget.messages.length || widget.isStreaming) {
      _scrollToBottom();
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _handleSend() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    widget.onSend?.call(text);
    _controller.clear();
  }

  @override
  Widget build(BuildContext context) {
    final c = MonetColors.of(context);
    return Column(
      children: [
        Expanded(
          child: ListView.builder(
            controller: _scrollController,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            itemCount: widget.messages.length + (widget.isStreaming ? 1 : 0),
            itemBuilder: (context, index) {
              if (index == widget.messages.length && widget.isStreaming) {
                return _buildTypingIndicator();
              }
              return _buildBubble(widget.messages[index]);
            },
          ),
        ),
        if (widget.suggestions.isNotEmpty) _buildSuggestions(),
        _buildInput(),
      ],
    );
  }

  Widget _buildBubble(ChatMessage message) {
    if (message.isError) {
      return _buildErrorCard(message);
    }
    if (message.isApproval) {
      return _buildApprovalCard(message);
    }
    if (message.isSystem) {
      return _buildSystemMessage(message);
    }

    final c = MonetColors.of(context);
    final isUser = message.isUser;
    final maxWidth = MediaQuery.of(context).size.width * 0.65;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment:
            isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        children: [
          Container(
            constraints: BoxConstraints(maxWidth: maxWidth),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: BoxDecoration(
              color: isUser
                  ? c.primary
                  : c.surfaceSecondary,
              borderRadius: BorderRadius.only(
                topLeft: const Radius.circular(16),
                topRight: const Radius.circular(16),
                bottomLeft: Radius.circular(isUser ? 16 : 4),
                bottomRight: Radius.circular(isUser ? 4 : 16),
              ),
            ),
            child: Text(
              message.content,
              style: TextStyle(
                color: c.textPrimary,
                fontSize: 15,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSystemMessage(ChatMessage message) {
    final c = MonetColors.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: c.border,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.build_outlined, size: 14, color: c.textTertiary),
              const SizedBox(width: 6),
              Text(
                message.content,
                style: TextStyle(
                  color: c.textTertiary,
                  fontSize: 12,
                  fontStyle: FontStyle.italic,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildErrorCard(ChatMessage message) {
    final c = MonetColors.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Container(
            constraints: BoxConstraints(
              maxWidth: MediaQuery.of(context).size.width * 0.75,
            ),
            decoration: BoxDecoration(
              color: c.errorSurface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: c.error.withValues(alpha: 0.3)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                  child: Row(
                    children: [
                      Icon(
                        Icons.error_outline,
                        size: 16,
                        color: c.error,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        'Error',
                        style: TextStyle(
                          color: c.error,
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                  child: Text(
                    message.content,
                    style: TextStyle(
                      color: c.textSecondary,
                      fontSize: 14,
                      height: 1.4,
                    ),
                  ),
                ),
                if (message.isRetryable && widget.onRetry != null)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                    child: FilledButton.icon(
                      onPressed: widget.onRetry,
                      icon: const Icon(Icons.refresh, size: 16),
                      label: const Text('Retry'),
                      style: FilledButton.styleFrom(
                        backgroundColor: c.error,
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildApprovalCard(ChatMessage message) {
    final c = MonetColors.of(context);
    final isPending = message.approvalStatus == 'pending';
    final isApproved = message.approvalStatus == 'approved';
    final displayName = (message.toolName ?? 'action').replaceAll('_', ' ');
    final params = message.approvalParameters;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Container(
            constraints: BoxConstraints(
              maxWidth: MediaQuery.of(context).size.width * 0.75,
            ),
            decoration: BoxDecoration(
              color: c.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: isPending
                    ? c.primary.withValues(alpha: 0.3)
                    : isApproved
                        ? c.success.withValues(alpha: 0.3)
                        : c.error.withValues(alpha: 0.3),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                  child: Row(
                    children: [
                      Icon(
                        Icons.shield_outlined,
                        size: 16,
                        color: c.primary,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        displayName,
                        style: TextStyle(
                          color: c.primary,
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                if (params.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                    child: Text(
                      params.entries.map((e) => '${e.key}: ${e.value}').join('\n'),
                      style: TextStyle(
                        color: c.textTertiary,
                        fontSize: 12,
                        fontFamily: 'monospace',
                        height: 1.4,
                      ),
                      maxLines: 5,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                if (isPending)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        TextButton(
                          onPressed: () {
                            if (message.approvalId != null) {
                              widget.onApprovalDecision?.call(
                                message.approvalId!,
                                false,
                              );
                            }
                          },
                          style: TextButton.styleFrom(
                            foregroundColor: c.error,
                            padding: const EdgeInsets.symmetric(horizontal: 16),
                          ),
                          child: const Text('Reject'),
                        ),
                        const SizedBox(width: 8),
                        FilledButton(
                          onPressed: () {
                            if (message.approvalId != null) {
                              widget.onApprovalDecision?.call(
                                message.approvalId!,
                                true,
                              );
                            }
                          },
                          style: FilledButton.styleFrom(
                            backgroundColor: c.success,
                            padding: const EdgeInsets.symmetric(horizontal: 16),
                          ),
                          child: const Text('Approve'),
                        ),
                      ],
                    ),
                  )
                else
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          isApproved ? Icons.check_circle : Icons.cancel,
                          size: 14,
                          color: isApproved ? c.success : c.error,
                        ),
                        const SizedBox(width: 6),
                        Text(
                          isApproved ? 'Approved' : 'Rejected',
                          style: TextStyle(
                            color: isApproved ? c.success : c.error,
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTypingIndicator() {
    final c = MonetColors.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: c.surfaceSecondary,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: List.generate(3, (i) {
                return Padding(
                  padding: EdgeInsets.only(left: i > 0 ? 4 : 0),
                  child: _TypingDot(delay: i * 200),
                );
              }),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSuggestions() {
    final c = MonetColors.of(context);
    return Container(
      height: 44,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: widget.suggestions.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          return ActionChip(
            label: Text(
              widget.suggestions[index],
              style: TextStyle(color: c.textSecondary, fontSize: 13),
            ),
            backgroundColor: c.surfaceSecondary,
            side: BorderSide(color: c.border),
            onPressed: () =>
                widget.onSuggestionTap?.call(widget.suggestions[index]),
          );
        },
      ),
    );
  }

  Widget _buildInput() {
    final c = MonetColors.of(context);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: c.scaffoldBg,
        border: Border(
          top: BorderSide(color: c.border),
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: _controller,
              style: TextStyle(color: c.textPrimary, fontSize: 15),
              decoration: InputDecoration(
                hintText: 'Type a message...',
                hintStyle: TextStyle(
                  color: c.textMeta,
                ),
                filled: true,
                fillColor: c.surface,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(24),
                  borderSide: BorderSide.none,
                ),
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 20,
                  vertical: 10,
                ),
              ),
              onSubmitted: (_) => _handleSend(),
            ),
          ),
          const SizedBox(width: 4),
          VoiceButton(
            onTranscribed: (text) {
              _controller.text = text;
              _handleSend();
            },
          ),
          const SizedBox(width: 4),
          IconButton(
            onPressed: _handleSend,
            icon: const Icon(Icons.send),
            color: c.primary,
          ),
        ],
      ),
    );
  }
}

class _TypingDot extends StatefulWidget {
  final int delay;
  const _TypingDot({required this.delay});

  @override
  State<_TypingDot> createState() => _TypingDotState();
}

class _TypingDotState extends State<_TypingDot>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    _animation = Tween<double>(begin: 0, end: 1).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );
    Future.delayed(Duration(milliseconds: widget.delay), () {
      if (mounted) _controller.repeat(reverse: true);
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = MonetColors.of(context);
    return AnimatedBuilder(
      animation: _animation,
      builder: (context, child) {
        return Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(
            color: c.textMeta.withValues(alpha: 0.3 + _animation.value * 0.4),
            shape: BoxShape.circle,
          ),
        );
      },
    );
  }
}
