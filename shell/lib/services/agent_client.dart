import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

class AgentEvent {
  final String type;
  final String data;
  final Map<String, dynamic> metadata;

  AgentEvent({
    required this.type,
    required this.data,
    this.metadata = const {},
  });

  factory AgentEvent.fromJson(Map<String, dynamic> json) {
    return AgentEvent(
      type: json['type'] as String? ?? '',
      data: json['data'] as String? ?? '',
      metadata: json['metadata'] as Map<String, dynamic>? ?? {},
    );
  }
}

class AgentOutput {
  final String content;
  final String status;
  final Map<String, dynamic> metadata;

  AgentOutput({
    required this.content,
    this.status = 'complete',
    this.metadata = const {},
  });

  factory AgentOutput.fromJson(Map<String, dynamic> json) {
    return AgentOutput(
      content: json['content'] as String? ?? '',
      status: json['status'] as String? ?? 'complete',
      metadata: json['metadata'] as Map<String, dynamic>? ?? {},
    );
  }
}

class AgentResult {
  final String agent;
  final String uiPattern;
  final List<AgentOutput> outputs;

  AgentResult({
    required this.agent,
    required this.uiPattern,
    this.outputs = const [],
  });

  factory AgentResult.fromJson(Map<String, dynamic> json) {
    return AgentResult(
      agent: json['agent'] as String? ?? '',
      uiPattern: json['ui_pattern'] as String? ?? 'chat',
      outputs: (json['outputs'] as List<dynamic>?)
              ?.map((o) => AgentOutput.fromJson(o as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }
}

class ApprovalRequest {
  final String id;
  final String toolName;
  final Map<String, dynamic> parameters;
  final String status;
  final String? sessionId;

  ApprovalRequest({
    required this.id,
    required this.toolName,
    this.parameters = const {},
    this.status = 'pending',
    this.sessionId,
  });

  factory ApprovalRequest.fromJson(Map<String, dynamic> json) {
    return ApprovalRequest(
      id: json['id'] as String? ?? '',
      toolName: json['tool_name'] as String? ?? '',
      parameters: json['parameters'] as Map<String, dynamic>? ?? {},
      status: json['status'] as String? ?? 'pending',
      sessionId: json['session_id'] as String?,
    );
  }
}

class AgentClient {
  final String baseUrl;
  final http.Client _client;

  AgentClient({
    this.baseUrl = 'http://localhost:8000',
    http.Client? client,
  }) : _client = client ?? http.Client();

  Future<bool> healthCheck() async {
    try {
      final response = await _client.get(Uri.parse('$baseUrl/api/health'));
      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  Future<AgentResult> run(String intent, {String? sessionId}) async {
    final body = <String, dynamic>{'intent': intent};
    if (sessionId != null) body['session_id'] = sessionId;

    final response = await _client.post(
      Uri.parse('$baseUrl/api/run'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(body),
    );

    if (response.statusCode != 200) {
      throw Exception('Agent run failed: ${response.statusCode}');
    }

    return AgentResult.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Stream<AgentEvent> stream(String intent, {String? sessionId}) async* {
    final body = <String, dynamic>{'intent': intent};
    if (sessionId != null) body['session_id'] = sessionId;

    final request = http.Request('POST', Uri.parse('$baseUrl/api/stream'));
    request.headers['Content-Type'] = 'application/json';
    request.body = jsonEncode(body);

    final streamedResponse = await _client.send(request);

    await for (final chunk in streamedResponse.stream
        .transform(utf8.decoder)
        .transform(const LineSplitter())) {
      if (chunk.trim().isEmpty) continue;
      try {
        final json = jsonDecode(chunk) as Map<String, dynamic>;
        yield AgentEvent.fromJson(json);
      } catch (_) {
        // Skip malformed lines
      }
    }
  }

  Future<List<ApprovalRequest>> listApprovals({String? sessionId}) async {
    var url = '$baseUrl/api/approvals';
    if (sessionId != null) url += '?session_id=$sessionId';

    final response = await _client.get(Uri.parse(url));
    if (response.statusCode != 200) {
      throw Exception('Failed to list approvals: ${response.statusCode}');
    }

    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => ApprovalRequest.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<ApprovalRequest> approve(String id) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/approvals/$id/approve'),
    );
    if (response.statusCode != 200) {
      throw Exception('Failed to approve: ${response.statusCode}');
    }
    return ApprovalRequest.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<ApprovalRequest> reject(String id) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/approvals/$id/reject'),
    );
    if (response.statusCode != 200) {
      throw Exception('Failed to reject: ${response.statusCode}');
    }
    return ApprovalRequest.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  void dispose() {
    _client.close();
  }
}
