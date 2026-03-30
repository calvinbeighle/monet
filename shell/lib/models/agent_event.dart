/// agent_event.dart
///
/// Defines all event types received from the Monet agent backend via SSE.
/// Events drive UI pattern switching and content updates.

/// The set of UI pattern types the agent can request.
enum UiPattern {
  none,
  tinder,
  chat,
  diff,
  whiteboard,
}

/// Converts a raw string from the backend into a UiPattern enum value.
UiPattern uiPatternFromString(String? value) {
  switch (value) {
    case 'tinder':
      return UiPattern.tinder;
    case 'chat':
      return UiPattern.chat;
    case 'diff':
      return UiPattern.diff;
    case 'whiteboard':
      return UiPattern.whiteboard;
    default:
      return UiPattern.none;
  }
}

/// Base class for all agent events received over SSE.
abstract class AgentEvent {
  const AgentEvent();
}

/// Fired when the agent starts processing a new intent.
class AgentStartedEvent extends AgentEvent {
  final String sessionId;
  final String agentName;
  final UiPattern uiPattern;

  const AgentStartedEvent({
    required this.sessionId,
    required this.agentName,
    required this.uiPattern,
  });
}

/// A chunk of streaming text content from the agent.
class AgentTextChunkEvent extends AgentEvent {
  final String text;
  const AgentTextChunkEvent({required this.text});
}

/// A complete message (not streaming) from the agent.
class AgentMessageEvent extends AgentEvent {
  final String role;
  final String content;
  const AgentMessageEvent({required this.role, required this.content});
}

/// A card for the Tinder swipe UI pattern.
class AgentCardEvent extends AgentEvent {
  final String id;
  final String title;
  final String body;
  final Map<String, dynamic> metadata;

  const AgentCardEvent({
    required this.id,
    required this.title,
    required this.body,
    this.metadata = const {},
  });
}

/// A diff payload for the Diff UI pattern.
class AgentDiffEvent extends AgentEvent {
  final String original;
  final String proposed;
  final String? label;

  const AgentDiffEvent({
    required this.original,
    required this.proposed,
    this.label,
  });
}

/// A whiteboard node to be placed on the canvas.
class AgentWhiteboardNodeEvent extends AgentEvent {
  final String id;
  final String content;
  final double x;
  final double y;

  const AgentWhiteboardNodeEvent({
    required this.id,
    required this.content,
    required this.x,
    required this.y,
  });
}

/// Signals the agent has finished processing.
class AgentDoneEvent extends AgentEvent {
  const AgentDoneEvent();
}

/// Signals an error from the agent or connection.
class AgentErrorEvent extends AgentEvent {
  final String message;
  const AgentErrorEvent({required this.message});
}
