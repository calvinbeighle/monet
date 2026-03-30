/// agent_client.dart
///
/// HTTP and SSE client that communicates with the Monet agent backend at
/// http://localhost:8420. Exposes methods to submit intents and stream
/// agent responses back as AgentEvent objects.

import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/agent_event.dart';

/// Base URL for the agent backend - runs on the same VM.
const String _kBaseUrl = 'http://localhost:8420';

/// Submits a user intent to the backend and returns the initial session info.
///
/// Throws an [Exception] if the request fails or returns a non-200 status.
Future<Map<String, dynamic>> submitIntent(String text) async {
  final uri = Uri.parse('$_kBaseUrl/intent');
  final response = await http.post(
    uri,
    headers: {'Content-Type': 'application/json'},
    body: jsonEncode({'text': text}),
  );

  if (response.statusCode != 200) {
    throw Exception(
      'Intent submission failed with status ${response.statusCode}: ${response.body}',
    );
  }

  final data = jsonDecode(response.body) as Map<String, dynamic>;
  return data;
}

/// Opens an SSE stream for the given session and yields [AgentEvent]s.
///
/// The stream remains open until the agent sends a [done] event, the
/// connection drops, or the caller cancels the subscription.
Stream<AgentEvent> streamSession(String sessionId) async* {
  final uri = Uri.parse('$_kBaseUrl/stream/$sessionId');
  final client = http.Client();

  try {
    final request = http.Request('GET', uri);
    request.headers['Accept'] = 'text/event-stream';
    request.headers['Cache-Control'] = 'no-cache';

    final streamedResponse = await client.send(request);

    if (streamedResponse.statusCode != 200) {
      throw Exception(
        'SSE stream failed with status ${streamedResponse.statusCode}',
      );
    }

    String buffer = '';

    await for (final chunk in streamedResponse.stream.transform(utf8.decoder)) {
      buffer += chunk;

      // SSE messages are separated by double newlines
      while (buffer.contains('\n\n')) {
        final separatorIndex = buffer.indexOf('\n\n');
        final rawMessage = buffer.substring(0, separatorIndex);
        buffer = buffer.substring(separatorIndex + 2);

        final event = _parseSseMessage(rawMessage);
        if (event != null) {
          yield event;
          if (event is AgentDoneEvent) return;
        }
      }
    }
  } finally {
    client.close();
  }
}

/// Parses a raw SSE message block into an [AgentEvent].
///
/// Returns null if the message cannot be parsed or is a comment/heartbeat.
AgentEvent? _parseSseMessage(String rawMessage) {
  String? eventType;
  String? dataLine;

  for (final line in rawMessage.split('\n')) {
    if (line.startsWith('event:')) {
      eventType = line.substring(6).trim();
    } else if (line.startsWith('data:')) {
      dataLine = line.substring(5).trim();
    }
  }

  if (dataLine == null) return null;

  // Handle plain data without explicit event type
  eventType ??= 'message';

  try {
    if (dataLine == '[DONE]' || eventType == 'done') {
      return const AgentDoneEvent();
    }

    final data = jsonDecode(dataLine) as Map<String, dynamic>;

    switch (eventType) {
      case 'started':
        return AgentStartedEvent(
          sessionId: data['session_id'] as String? ?? '',
          agentName: data['agent'] as String? ?? 'agent',
          uiPattern: uiPatternFromString(data['ui_pattern'] as String?),
        );

      case 'text_chunk':
        return AgentTextChunkEvent(
          text: data['text'] as String? ?? '',
        );

      case 'message':
        // If data has 'role' and 'content' treat as chat message
        if (data.containsKey('role') && data.containsKey('content')) {
          return AgentMessageEvent(
            role: data['role'] as String? ?? 'assistant',
            content: data['content'] as String? ?? '',
          );
        }
        // If data has a 'text' field treat as a chunk
        if (data.containsKey('text')) {
          return AgentTextChunkEvent(text: data['text'] as String? ?? '');
        }
        return null;

      case 'card':
        return AgentCardEvent(
          id: data['id'] as String? ?? UniqueKey().toString(),
          title: data['title'] as String? ?? '',
          body: data['body'] as String? ?? '',
          metadata: data['metadata'] as Map<String, dynamic>? ?? {},
        );

      case 'diff':
        return AgentDiffEvent(
          original: data['original'] as String? ?? '',
          proposed: data['proposed'] as String? ?? '',
          label: data['label'] as String?,
        );

      case 'node':
        return AgentWhiteboardNodeEvent(
          id: data['id'] as String? ?? '',
          content: data['content'] as String? ?? '',
          x: (data['x'] as num?)?.toDouble() ?? 0.0,
          y: (data['y'] as num?)?.toDouble() ?? 0.0,
        );

      case 'error':
        return AgentErrorEvent(
          message: data['message'] as String? ?? 'Unknown error',
        );

      default:
        return null;
    }
  } catch (_) {
    // Malformed JSON or unexpected structure - skip the event
    return null;
  }
}

/// Returns a placeholder key for anonymous objects.
UniqueKey() => Object().hashCode.toString();

/// Checks whether the backend is reachable by hitting the health endpoint.
///
/// Returns true if the backend responds with a 200-level status.
Future<bool> checkBackendHealth() async {
  try {
    final uri = Uri.parse('$_kBaseUrl/health');
    final response = await http.get(uri).timeout(
      const Duration(seconds: 3),
    );
    return response.statusCode >= 200 && response.statusCode < 300;
  } catch (_) {
    return false;
  }
}
