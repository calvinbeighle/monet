import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

const _tokenKey = 'monet_auth_token';
const _usernameKey = 'monet_auth_username';

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
  String? _authToken;
  String? _username;

  AgentClient({
    this.baseUrl = 'http://localhost:8000',
    http.Client? client,
  }) : _client = client ?? http.Client();

  String? get authToken => _authToken;
  String? get username => _username;

  /// Check if any user account exists (first-boot detection).
  Future<Map<String, dynamic>> authStatus() async {
    final response = await _client.get(Uri.parse('$baseUrl/api/auth/status'));
    if (response.statusCode != 200) {
      throw Exception('Auth status check failed: ${response.statusCode}');
    }
    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  /// Create a new user account. Stores the returned session token for persistence.
  Future<Map<String, dynamic>> createUser(String username, String password) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/auth/create'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'username': username, 'password': password}),
    );
    if (response.statusCode != 200) {
      final detail = (jsonDecode(response.body) as Map<String, dynamic>)['detail'] ?? 'Unknown error';
      throw Exception(detail);
    }
    final data = jsonDecode(response.body) as Map<String, dynamic>;
    await _persistToken(data['token'] as String?, username);
    return data;
  }

  /// Authenticate a user. Stores the returned session token for persistence.
  Future<Map<String, dynamic>> login(String username, String password) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/auth/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'username': username, 'password': password}),
    );
    if (response.statusCode == 401) {
      throw Exception('Invalid username or password');
    }
    if (response.statusCode != 200) {
      throw Exception('Login failed: ${response.statusCode}');
    }
    final data = jsonDecode(response.body) as Map<String, dynamic>;
    await _persistToken(data['token'] as String?, username);
    return data;
  }

  /// Try to restore a session from a previously stored token.
  /// Returns the username if the token is still valid, null otherwise.
  Future<String?> tryRestoreSession() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString(_tokenKey);
    if (token == null) return null;

    try {
      final response = await _client.get(
        Uri.parse('$baseUrl/api/auth/verify?token=$token'),
      );
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        _authToken = token;
        _username = data['username'] as String?;
        return _username;
      }
    } catch (_) {
      // Backend unreachable - clear stale token
    }
    // Token invalid or backend down - clear stored credentials
    await _clearPersistedToken();
    return null;
  }

  /// Logout: revoke the token on the backend and clear local storage.
  Future<void> logout() async {
    if (_authToken != null) {
      try {
        await _client.post(
          Uri.parse('$baseUrl/api/auth/logout?token=$_authToken'),
        );
      } catch (_) {
        // Best-effort revocation - clear locally regardless
      }
    }
    _authToken = null;
    _username = null;
    await _clearPersistedToken();
  }

  Future<void> _persistToken(String? token, String username) async {
    _authToken = token;
    _username = username;
    if (token != null) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_tokenKey, token);
      await prefs.setString(_usernameKey, username);
    }
  }

  Future<void> _clearPersistedToken() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
    await prefs.remove(_usernameKey);
  }

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

    http.StreamedResponse streamedResponse;
    try {
      streamedResponse = await _client.send(request);
    } on http.ClientException catch (e) {
      yield AgentEvent(
        type: 'error',
        data: 'Cannot connect to agent backend. Is the server running?',
        metadata: {'error_type': 'connection_error', 'retryable': true, 'detail': e.toString()},
      );
      yield AgentEvent(type: 'done', data: '');
      return;
    } catch (e) {
      yield AgentEvent(
        type: 'error',
        data: 'Network error: ${e.toString()}',
        metadata: {'error_type': 'connection_error', 'retryable': true},
      );
      yield AgentEvent(type: 'done', data: '');
      return;
    }

    if (streamedResponse.statusCode != 200) {
      yield AgentEvent(
        type: 'error',
        data: 'Server error (${streamedResponse.statusCode}). Please try again.',
        metadata: {'error_type': 'server_error', 'retryable': true},
      );
      yield AgentEvent(type: 'done', data: '');
      return;
    }

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

  /// Signal the backend that the user is ready for the next flow step.
  Future<void> advanceFlow(
    String sessionId,
    int stepIndex,
    Map<String, dynamic> userState,
  ) async {
    await _client.post(
      Uri.parse('$baseUrl/api/flow/advance'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'session_id': sessionId,
        'step_index': stepIndex,
        'user_state': userState,
      }),
    );
  }

  // --- System integration ---

  /// Get full system state (WiFi, volume, brightness).
  Future<Map<String, dynamic>> systemState() async {
    final response = await _client.get(Uri.parse('$baseUrl/api/system/state'));
    if (response.statusCode != 200) {
      throw Exception('Failed to get system state: ${response.statusCode}');
    }
    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  /// Get current WiFi status.
  Future<Map<String, dynamic>> wifiStatus() async {
    final response = await _client.get(Uri.parse('$baseUrl/api/system/wifi/status'));
    if (response.statusCode != 200) {
      throw Exception('WiFi status failed: ${response.statusCode}');
    }
    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  /// Scan for available WiFi networks.
  Future<List<Map<String, dynamic>>> wifiScan() async {
    final response = await _client.get(Uri.parse('$baseUrl/api/system/wifi/scan'));
    if (response.statusCode != 200) {
      throw Exception('WiFi scan failed: ${response.statusCode}');
    }
    return (jsonDecode(response.body) as List<dynamic>)
        .cast<Map<String, dynamic>>();
  }

  /// Connect to a WiFi network.
  Future<void> wifiConnect(String ssid, {String? password}) async {
    final body = <String, dynamic>{'ssid': ssid};
    if (password != null) body['password'] = password;
    final response = await _client.post(
      Uri.parse('$baseUrl/api/system/wifi/connect'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(body),
    );
    if (response.statusCode != 200) {
      throw Exception('WiFi connect failed: ${response.statusCode}');
    }
  }

  /// Disconnect from WiFi.
  Future<void> wifiDisconnect() async {
    await _client.post(Uri.parse('$baseUrl/api/system/wifi/disconnect'));
  }

  /// Get current volume state.
  Future<Map<String, dynamic>> volumeGet() async {
    final response = await _client.get(Uri.parse('$baseUrl/api/system/volume'));
    if (response.statusCode != 200) {
      throw Exception('Volume get failed: ${response.statusCode}');
    }
    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  /// Set volume level (0-100).
  Future<Map<String, dynamic>> volumeSet(int level) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/system/volume'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'level': level}),
    );
    if (response.statusCode != 200) {
      throw Exception('Volume set failed: ${response.statusCode}');
    }
    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  /// Toggle mute.
  Future<Map<String, dynamic>> volumeMuteToggle() async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/system/volume/mute'),
    );
    if (response.statusCode != 200) {
      throw Exception('Mute toggle failed: ${response.statusCode}');
    }
    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  /// Get current brightness.
  Future<Map<String, dynamic>> brightnessGet() async {
    final response = await _client.get(Uri.parse('$baseUrl/api/system/brightness'));
    if (response.statusCode != 200) {
      throw Exception('Brightness get failed: ${response.statusCode}');
    }
    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  /// Set brightness level (0-100).
  Future<Map<String, dynamic>> brightnessSet(int level) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/system/brightness'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'level': level}),
    );
    if (response.statusCode != 200) {
      throw Exception('Brightness set failed: ${response.statusCode}');
    }
    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  /// Execute a power action (shutdown, restart, suspend).
  Future<void> powerAction(String action) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/system/power'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'action': action}),
    );
    if (response.statusCode != 200) {
      throw Exception('Power action failed: ${response.statusCode}');
    }
  }

  void dispose() {
    _client.close();
  }
}
