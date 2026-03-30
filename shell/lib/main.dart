import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'services/agent_client.dart';
import 'ui/approval_overlay.dart';
import 'ui/patterns/chat.dart';
import 'ui/patterns/diff.dart';
import 'ui/patterns/tinder.dart';
import 'ui/patterns/whiteboard.dart';
import 'ui/status_bar.dart';

void main() {
  runApp(const MonetApp());
}

class MonetApp extends StatelessWidget {
  const MonetApp({super.key});

  @override
  Widget build(BuildContext context) {
    return Provider<AgentClient>(
      create: (_) => AgentClient(),
      dispose: (_, client) => client.dispose(),
      child: MaterialApp(
        title: 'Monet',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          brightness: Brightness.dark,
          scaffoldBackgroundColor: const Color(0xFF0A0A0F),
          fontFamily: 'Inter',
          colorScheme: const ColorScheme.dark(
            surface: Color(0xFF12121A),
            primary: Color(0xFF7C6EF0),
          ),
        ),
        home: const MonetShell(),
      ),
    );
  }
}

class MonetShell extends StatefulWidget {
  const MonetShell({super.key});

  @override
  State<MonetShell> createState() => MonetShellState();
}

class MonetShellState extends State<MonetShell> {
  final TextEditingController _intentController = TextEditingController();

  String? _activePattern;
  String? _activeAgent;
  bool _isRunning = false;
  String? _sessionId;

  // Chat state
  final List<ChatMessage> _chatMessages = [];
  final List<String> _chatSuggestions = [];
  bool _chatStreaming = false;

  // Tinder state
  List<TinderCard> _tinderCards = [];

  // Diff state
  List<DiffLine> _diffLines = [];

  // Whiteboard state
  List<WhiteboardNode> _whiteboardNodes = [];

  // Pending approvals mapped by approval ID
  final List<_PendingApproval> _pendingApprovals = [];

  StreamSubscription<AgentEvent>? _streamSub;

  @override
  void dispose() {
    _intentController.dispose();
    _streamSub?.cancel();
    super.dispose();
  }

  void _submitIntent(String intent) {
    if (intent.trim().isEmpty || _isRunning) return;
    _intentController.clear();

    final client = context.read<AgentClient>();

    setState(() {
      _isRunning = true;
      _chatStreaming = true;
      _chatMessages.add(ChatMessage(content: intent, isUser: true));
    });

    String streamedContent = '';

    _streamSub?.cancel();
    _streamSub = client.stream(intent, sessionId: _sessionId).listen(
      (event) {
        switch (event.type) {
          case 'routing':
            setState(() {
              _activePattern = event.metadata['ui_pattern'] as String?;
              _activeAgent = event.metadata['agent'] as String?;
              _sessionId ??= event.metadata['session_id'] as String?;
            });
          case 'token':
            streamedContent += event.data;
          case 'tool_call':
            final toolName = event.data;
            setState(() {
              _chatMessages.add(
                ChatMessage(
                  content: 'Using tool: ${toolName.replaceAll('_', ' ')}',
                  isUser: false,
                  isSystem: true,
                ),
              );
            });
          case 'approval_request':
            final approvalId = event.metadata['approval_id'] as String? ?? '';
            final toolName = event.data;
            final parameters = event.metadata['parameters'] as Map<String, dynamic>? ?? {};
            _showApprovalDialog(approvalId, toolName, parameters);
          case 'done':
            setState(() {
              _chatStreaming = false;
              _isRunning = false;
              if (streamedContent.isNotEmpty) {
                _chatMessages.add(
                  ChatMessage(content: streamedContent, isUser: false),
                );
              }
              _applyPatternData(event.metadata);
            });
        }
      },
      onError: (error) {
        setState(() {
          _chatStreaming = false;
          _isRunning = false;
          _chatMessages.add(
            ChatMessage(content: 'Error: $error', isUser: false),
          );
        });
      },
      onDone: () {
        setState(() {
          _chatStreaming = false;
          _isRunning = false;
        });
      },
    );
  }

  void _showApprovalDialog(
    String approvalId,
    String toolName,
    Map<String, dynamic> parameters,
  ) {
    final client = context.read<AgentClient>();
    _pendingApprovals.add(_PendingApproval(
      id: approvalId,
      toolName: toolName,
      parameters: parameters,
    ));

    ApprovalOverlay.show(
      context: context,
      toolName: toolName,
      parameters: parameters,
      approvalId: approvalId,
      client: client,
      onResolved: () {
        _pendingApprovals.removeWhere((a) => a.id == approvalId);
      },
    );
  }

  void _applyPatternData(Map<String, dynamic> metadata) {
    final outputs = metadata['outputs'] as List<dynamic>? ?? [];

    switch (_activePattern) {
      case 'tinder':
        _tinderCards = outputs
            .map((o) => TinderCard(
                  title: (o as Map<String, dynamic>)['title'] as String? ??
                      o['content'] as String? ??
                      '',
                  body: o['body'] as String? ?? o['content'] as String? ?? '',
                  metadata: o,
                ))
            .toList();
      case 'diff':
        _diffLines = outputs
            .map((o) => DiffLine(
                  left: (o as Map<String, dynamic>)['left'] as String?,
                  right: o['right'] as String?,
                  type: _parseDiffType(o['type'] as String?),
                ))
            .toList();
      case 'whiteboard':
        _whiteboardNodes = outputs
            .map((o) => WhiteboardNode(
                  id: (o as Map<String, dynamic>)['id'] as String? ?? '',
                  title: o['title'] as String? ?? '',
                  body: o['body'] as String? ?? '',
                  x: (o['x'] as num?)?.toDouble() ?? 0,
                  y: (o['y'] as num?)?.toDouble() ?? 0,
                  connections: (o['connections'] as List<dynamic>?)
                          ?.cast<String>() ??
                      [],
                ))
            .toList();
    }
  }

  DiffType _parseDiffType(String? type) {
    switch (type) {
      case 'added':
        return DiffType.added;
      case 'removed':
        return DiffType.removed;
      case 'modified':
        return DiffType.modified;
      default:
        return DiffType.unchanged;
    }
  }

  void _handleTinderDecision(int index, bool approved) {
    final client = context.read<AgentClient>();
    // If the card has an approval_id in its metadata, resolve it on the backend
    if (index < _tinderCards.length) {
      final card = _tinderCards[index];
      final approvalId = card.metadata['approval_id'] as String?;
      if (approvalId != null) {
        if (approved) {
          client.approve(approvalId);
        } else {
          client.reject(approvalId);
        }
      }
    }
  }

  void _handleDiffDecision(bool approved) {
    final client = context.read<AgentClient>();
    // Resolve all pending approvals for the current session
    for (final pending in List.of(_pendingApprovals)) {
      if (approved) {
        client.approve(pending.id);
      } else {
        client.reject(pending.id);
      }
    }
    _pendingApprovals.clear();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          _buildIntentBar(),
          Expanded(child: _buildActivePattern()),
          StatusBar(
            tools: const [
              ConnectedTool(name: 'Gmail', connected: false),
              ConnectedTool(name: 'GitHub', connected: false),
            ],
            activeAgent: _isRunning ? _activeAgent : null,
            activePattern: _activePattern,
          ),
        ],
      ),
    );
  }

  Widget _buildIntentBar() {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      decoration: BoxDecoration(
        color: const Color(0xFF0A0A0F),
        border: Border(
          bottom: BorderSide(color: Colors.white.withValues(alpha: 0.1)),
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: TextField(
          controller: _intentController,
          style: const TextStyle(color: Colors.white, fontSize: 16),
          decoration: InputDecoration(
            hintText: 'What would you like to do?',
            hintStyle: TextStyle(color: Colors.white.withValues(alpha: 0.3)),
            filled: true,
            fillColor: const Color(0xFF12121A),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide.none,
            ),
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 20,
              vertical: 14,
            ),
            suffixIcon: _isRunning
                ? const Padding(
                    padding: EdgeInsets.all(12),
                    child: SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Color(0xFF7C6EF0),
                      ),
                    ),
                  )
                : IconButton(
                    onPressed: () => _submitIntent(_intentController.text),
                    icon: const Icon(Icons.arrow_forward),
                    color: const Color(0xFF7C6EF0),
                  ),
          ),
          onSubmitted: _submitIntent,
          enabled: !_isRunning,
        ),
      ),
    );
  }

  Widget _buildActivePattern() {
    switch (_activePattern) {
      case 'tinder':
        return TinderPattern(
          cards: _tinderCards,
          onDecision: _handleTinderDecision,
        );
      case 'diff':
        return DiffPattern(
          lines: _diffLines,
          onDecision: _handleDiffDecision,
        );
      case 'whiteboard':
        return WhiteboardPattern(
          nodes: _whiteboardNodes,
          onNodeTap: (id) {},
        );
      case 'chat':
      default:
        return ChatPattern(
          messages: _chatMessages,
          suggestions: _chatSuggestions,
          isStreaming: _chatStreaming,
          onSend: _submitIntent,
          onSuggestionTap: _submitIntent,
        );
    }
  }
}

class _PendingApproval {
  final String id;
  final String toolName;
  final Map<String, dynamic> parameters;

  _PendingApproval({
    required this.id,
    required this.toolName,
    required this.parameters,
  });
}
