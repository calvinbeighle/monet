/// session_provider.dart
///
/// Provider-based state management for the active agent session.
/// Handles submitting intents, streaming events, and updating the
/// Session model that drives the UI.

import 'dart:async';
import 'package:flutter/foundation.dart';
import '../models/agent_event.dart';
import '../models/session.dart';
import 'agent_client.dart' as client;

/// ChangeNotifier that owns the current session state and orchestrates
/// all communication with the Monet agent backend.
class SessionProvider extends ChangeNotifier {
  Session _session = const Session();
  StreamSubscription<AgentEvent>? _streamSubscription;
  bool _isBackendConnected = false;
  Timer? _healthCheckTimer;

  Session get session => _session;
  bool get isBackendConnected => _isBackendConnected;

  SessionProvider() {
    _startHealthCheck();
  }

  /// Starts a periodic health check against the backend.
  void _startHealthCheck() {
    _checkHealth();
    _healthCheckTimer = Timer.periodic(
      const Duration(seconds: 5),
      (_) => _checkHealth(),
    );
  }

  /// Pings the backend health endpoint and updates connection state.
  Future<void> _checkHealth() async {
    final isHealthy = await client.checkBackendHealth();
    if (isHealthy != _isBackendConnected) {
      _isBackendConnected = isHealthy;
      notifyListeners();
    }
  }

  /// Submits a user intent text to the agent backend.
  ///
  /// Transitions the session to [connecting], fires the POST /intent request,
  /// then opens an SSE stream to consume events as they arrive.
  Future<void> submitIntent(String text) async {
    if (text.trim().isEmpty) return;

    // Cancel any previous stream
    await _streamSubscription?.cancel();
    _streamSubscription = null;

    _session = Session(
      status: SessionStatus.connecting,
      messages: [ChatMessage(role: 'user', content: text)],
    );
    notifyListeners();

    try {
      final initialData = await client.submitIntent(text);

      final sessionId = initialData['session_id'] as String? ?? '';
      final agentName = initialData['agent'] as String? ?? 'agent';
      final uiPattern = uiPatternFromString(
        initialData['ui_pattern'] as String?,
      );

      _session = _session.copyWith(
        sessionId: sessionId,
        agentName: agentName,
        uiPattern: uiPattern,
        status: SessionStatus.streaming,
      );
      notifyListeners();

      _streamSubscription = client
          .streamSession(sessionId)
          .listen(
            _handleEvent,
            onError: _handleStreamError,
            onDone: _handleStreamDone,
          );
    } catch (e) {
      _session = _session.copyWith(
        status: SessionStatus.error,
        errorMessage: e.toString(),
      );
      notifyListeners();
    }
  }

  /// Processes a single [AgentEvent] and updates session state accordingly.
  void _handleEvent(AgentEvent event) {
    switch (event.runtimeType) {
      case AgentStartedEvent:
        final e = event as AgentStartedEvent;
        _session = _session.copyWith(
          sessionId: e.sessionId,
          agentName: e.agentName,
          uiPattern: e.uiPattern,
          status: SessionStatus.streaming,
        );

      case AgentTextChunkEvent:
        final e = event as AgentTextChunkEvent;
        final newBuffer = _session.streamingBuffer + e.text;
        // Update the last assistant message or add one if none exists
        final msgs = List<ChatMessage>.from(_session.messages);
        if (msgs.isNotEmpty && msgs.last.role == 'assistant') {
          msgs[msgs.length - 1] = msgs.last.copyWith(content: newBuffer);
        } else {
          msgs.add(ChatMessage(role: 'assistant', content: newBuffer));
        }
        _session = _session.copyWith(
          messages: msgs,
          streamingBuffer: newBuffer,
        );

      case AgentMessageEvent:
        final e = event as AgentMessageEvent;
        final msgs = List<ChatMessage>.from(_session.messages);
        // If there's a streaming assistant message, replace it
        if (e.role == 'assistant' &&
            msgs.isNotEmpty &&
            msgs.last.role == 'assistant') {
          msgs[msgs.length - 1] = ChatMessage(
            role: e.role,
            content: e.content,
          );
        } else {
          msgs.add(ChatMessage(role: e.role, content: e.content));
        }
        _session = _session.copyWith(messages: msgs, streamingBuffer: '');

      case AgentCardEvent:
        final e = event as AgentCardEvent;
        final cards = List<DecisionCard>.from(_session.cards);
        cards.add(
          DecisionCard(
            id: e.id,
            title: e.title,
            body: e.body,
            metadata: e.metadata,
          ),
        );
        _session = _session.copyWith(cards: cards);

      case AgentDiffEvent:
        final e = event as AgentDiffEvent;
        _session = _session.copyWith(
          diff: DiffPayload(
            original: e.original,
            proposed: e.proposed,
            label: e.label,
          ),
        );

      case AgentWhiteboardNodeEvent:
        final e = event as AgentWhiteboardNodeEvent;
        final nodes = List<WhiteboardNode>.from(_session.whiteboardNodes);
        nodes.add(
          WhiteboardNode(id: e.id, content: e.content, x: e.x, y: e.y),
        );
        _session = _session.copyWith(whiteboardNodes: nodes);

      case AgentDoneEvent:
        _session = _session.copyWith(
          status: SessionStatus.done,
          streamingBuffer: '',
        );

      case AgentErrorEvent:
        final e = event as AgentErrorEvent;
        _session = _session.copyWith(
          status: SessionStatus.error,
          errorMessage: e.message,
        );
    }

    notifyListeners();
  }

  /// Handles an error on the SSE stream.
  void _handleStreamError(Object error) {
    _session = _session.copyWith(
      status: SessionStatus.error,
      errorMessage: error.toString(),
    );
    notifyListeners();
  }

  /// Handles normal stream completion.
  void _handleStreamDone() {
    if (_session.status == SessionStatus.streaming) {
      _session = _session.copyWith(
        status: SessionStatus.done,
        streamingBuffer: '',
      );
      notifyListeners();
    }
  }

  /// Dismisses a Tinder card by ID and optionally records the decision.
  void dismissCard(String cardId, {required bool approved}) {
    final cards = _session.cards.where((c) => c.id != cardId).toList();
    _session = _session.copyWith(cards: cards);
    notifyListeners();
  }

  /// Moves a whiteboard node to a new position.
  void moveNode(String nodeId, double dx, double dy) {
    final nodes = List<WhiteboardNode>.from(_session.whiteboardNodes);
    for (final node in nodes) {
      if (node.id == nodeId) {
        node.x += dx;
        node.y += dy;
        break;
      }
    }
    _session = _session.copyWith(whiteboardNodes: nodes);
    notifyListeners();
  }

  /// Resets the session back to idle state.
  void resetSession() {
    _streamSubscription?.cancel();
    _streamSubscription = null;
    _session = const Session();
    notifyListeners();
  }

  @override
  void dispose() {
    _streamSubscription?.cancel();
    _healthCheckTimer?.cancel();
    super.dispose();
  }
}
