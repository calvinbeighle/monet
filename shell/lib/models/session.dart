/// session.dart
///
/// Holds the runtime state of an active agent session including the current
/// UI pattern, streamed messages, cards, diffs, and whiteboard nodes.

import 'agent_event.dart';

/// A single chat message in the session conversation.
class ChatMessage {
  final String role;
  final String content;

  const ChatMessage({required this.role, required this.content});

  ChatMessage copyWith({String? role, String? content}) {
    return ChatMessage(
      role: role ?? this.role,
      content: content ?? this.content,
    );
  }
}

/// A swipeable decision card in the Tinder UI.
class DecisionCard {
  final String id;
  final String title;
  final String body;
  final Map<String, dynamic> metadata;

  const DecisionCard({
    required this.id,
    required this.title,
    required this.body,
    this.metadata = const {},
  });
}

/// A positioned node on the whiteboard canvas.
class WhiteboardNode {
  final String id;
  final String content;
  double x;
  double y;

  WhiteboardNode({
    required this.id,
    required this.content,
    required this.x,
    required this.y,
  });
}

/// A diff payload showing original vs proposed content.
class DiffPayload {
  final String original;
  final String proposed;
  final String? label;

  const DiffPayload({
    required this.original,
    required this.proposed,
    this.label,
  });
}

/// Represents the lifecycle state of an agent session.
enum SessionStatus {
  idle,
  connecting,
  streaming,
  done,
  error,
}

/// Full state of an active or recent agent session.
class Session {
  final String? sessionId;
  final String? agentName;
  final UiPattern uiPattern;
  final SessionStatus status;
  final List<ChatMessage> messages;
  final List<DecisionCard> cards;
  final DiffPayload? diff;
  final List<WhiteboardNode> whiteboardNodes;
  final String? errorMessage;
  final String streamingBuffer;

  const Session({
    this.sessionId,
    this.agentName,
    this.uiPattern = UiPattern.none,
    this.status = SessionStatus.idle,
    this.messages = const [],
    this.cards = const [],
    this.diff,
    this.whiteboardNodes = const [],
    this.errorMessage,
    this.streamingBuffer = '',
  });

  Session copyWith({
    String? sessionId,
    String? agentName,
    UiPattern? uiPattern,
    SessionStatus? status,
    List<ChatMessage>? messages,
    List<DecisionCard>? cards,
    DiffPayload? diff,
    List<WhiteboardNode>? whiteboardNodes,
    String? errorMessage,
    String? streamingBuffer,
    bool clearDiff = false,
    bool clearError = false,
  }) {
    return Session(
      sessionId: sessionId ?? this.sessionId,
      agentName: agentName ?? this.agentName,
      uiPattern: uiPattern ?? this.uiPattern,
      status: status ?? this.status,
      messages: messages ?? this.messages,
      cards: cards ?? this.cards,
      diff: clearDiff ? null : (diff ?? this.diff),
      whiteboardNodes: whiteboardNodes ?? this.whiteboardNodes,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      streamingBuffer: streamingBuffer ?? this.streamingBuffer,
    );
  }

  /// Returns true if the session is in an active (non-idle, non-error) state.
  bool get isActive =>
      status == SessionStatus.connecting || status == SessionStatus.streaming;
}
