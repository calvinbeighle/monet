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

class AgentStats {
  final int totalRuns;
  final int completed;
  final int errors;
  final int running;
  final int totalToolCalls;
  final int totalApprovals;
  final double? lastRunAt;

  AgentStats({
    this.totalRuns = 0,
    this.completed = 0,
    this.errors = 0,
    this.running = 0,
    this.totalToolCalls = 0,
    this.totalApprovals = 0,
    this.lastRunAt,
  });

  factory AgentStats.fromJson(Map<String, dynamic> json) {
    return AgentStats(
      totalRuns: json['total_runs'] as int? ?? 0,
      completed: json['completed'] as int? ?? 0,
      errors: json['errors'] as int? ?? 0,
      running: json['running'] as int? ?? 0,
      totalToolCalls: json['total_tool_calls'] as int? ?? 0,
      totalApprovals: json['total_approvals'] as int? ?? 0,
      lastRunAt: (json['last_run_at'] as num?)?.toDouble(),
    );
  }

  /// Current status derived from stats: running > idle
  String get currentStatus {
    if (running > 0) return 'working';
    if (totalRuns == 0) return 'idle';
    return 'idle';
  }
}

class AgentInfo {
  final String name;
  final String description;
  final String defaultUiPattern;
  final List<String> tools;
  final List<String> approvalRequired;
  final List<String> suggestions;
  final AgentStats stats;
  final bool custom;

  AgentInfo({
    required this.name,
    required this.description,
    required this.defaultUiPattern,
    this.tools = const [],
    this.approvalRequired = const [],
    this.suggestions = const [],
    required this.stats,
    this.custom = false,
  });

  factory AgentInfo.fromJson(Map<String, dynamic> json) {
    return AgentInfo(
      name: json['name'] as String? ?? '',
      description: json['description'] as String? ?? '',
      defaultUiPattern: json['default_ui_pattern'] as String? ?? 'chat',
      tools: (json['tools'] as List<dynamic>?)
              ?.map((t) => t.toString())
              .toList() ??
          [],
      approvalRequired: (json['approval_required'] as List<dynamic>?)
              ?.map((t) => t.toString())
              .toList() ??
          [],
      suggestions: (json['suggestions'] as List<dynamic>?)
              ?.map((t) => t.toString())
              .toList() ??
          [],
      stats: AgentStats.fromJson(
          json['stats'] != null
              ? Map<String, dynamic>.from(json['stats'] as Map)
              : {}),
      custom: json['custom'] as bool? ?? false,
    );
  }
}

class AgentActivity {
  final String id;
  final String agentName;
  final String intent;
  final String? sessionId;
  final String? uiPattern;
  final String status;
  final double startedAt;
  final double? finishedAt;
  final String? errorMessage;
  final int toolCallsCount;
  final int approvalsCount;
  final String? summary;

  AgentActivity({
    required this.id,
    required this.agentName,
    required this.intent,
    this.sessionId,
    this.uiPattern,
    required this.status,
    required this.startedAt,
    this.finishedAt,
    this.errorMessage,
    this.toolCallsCount = 0,
    this.approvalsCount = 0,
    this.summary,
  });

  factory AgentActivity.fromJson(Map<String, dynamic> json) {
    return AgentActivity(
      id: json['id'] as String? ?? '',
      agentName: json['agent_name'] as String? ?? '',
      intent: json['intent'] as String? ?? '',
      sessionId: json['session_id'] as String?,
      uiPattern: json['ui_pattern'] as String?,
      status: json['status'] as String? ?? 'running',
      startedAt: (json['started_at'] as num?)?.toDouble() ?? 0,
      finishedAt: (json['finished_at'] as num?)?.toDouble(),
      errorMessage: json['error_message'] as String?,
      toolCallsCount: json['tool_calls_count'] as int? ?? 0,
      approvalsCount: json['approvals_count'] as int? ?? 0,
      summary: json['summary'] as String?,
    );
  }

  Duration? get duration {
    if (finishedAt == null) return null;
    return Duration(milliseconds: ((finishedAt! - startedAt) * 1000).round());
  }
}

class AgentSchedule {
  final String id;
  final String agentName;
  final String intent;
  final String scheduleType;
  final int intervalMinutes;
  final String dailyTime;
  final bool enabled;
  final double lastRunAt;
  final double nextRunAt;
  final double createdAt;

  AgentSchedule({
    required this.id,
    required this.agentName,
    required this.intent,
    this.scheduleType = 'interval',
    this.intervalMinutes = 60,
    this.dailyTime = '09:00',
    this.enabled = true,
    this.lastRunAt = 0,
    this.nextRunAt = 0,
    this.createdAt = 0,
  });

  factory AgentSchedule.fromJson(Map<String, dynamic> json) {
    return AgentSchedule(
      id: json['id'] as String? ?? '',
      agentName: json['agent_name'] as String? ?? '',
      intent: json['intent'] as String? ?? '',
      scheduleType: json['schedule_type'] as String? ?? 'interval',
      intervalMinutes: json['interval_minutes'] as int? ?? 60,
      dailyTime: json['daily_time'] as String? ?? '09:00',
      enabled: json['enabled'] as bool? ?? true,
      lastRunAt: (json['last_run_at'] as num?)?.toDouble() ?? 0,
      nextRunAt: (json['next_run_at'] as num?)?.toDouble() ?? 0,
      createdAt: (json['created_at'] as num?)?.toDouble() ?? 0,
    );
  }

  String get scheduleLabel {
    if (scheduleType == 'daily') return 'Daily at $dailyTime';
    if (intervalMinutes < 60) return 'Every $intervalMinutes min';
    if (intervalMinutes == 60) return 'Every hour';
    final hours = intervalMinutes ~/ 60;
    final mins = intervalMinutes % 60;
    if (mins == 0) return 'Every $hours hr';
    return 'Every $hours hr $mins min';
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

  // --- Agent dashboard (SCOPE.md Feature 3: See Agents) ---

  /// List all registered agents with metadata, tools, and stats.
  Future<List<AgentInfo>> listAgents() async {
    final response = await _client.get(Uri.parse('$baseUrl/api/agents'));
    if (response.statusCode != 200) {
      throw Exception('Failed to list agents: ${response.statusCode}');
    }
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => AgentInfo.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  /// Get detailed info for a single agent including recent activity.
  Future<Map<String, dynamic>> getAgent(String name) async {
    final response = await _client.get(Uri.parse('$baseUrl/api/agents/$name'));
    if (response.statusCode != 200) {
      throw Exception('Failed to get agent: ${response.statusCode}');
    }
    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  /// Get recent activity across all agents.
  Future<List<AgentActivity>> agentsActivity({int limit = 50}) async {
    final response = await _client.get(
      Uri.parse('$baseUrl/api/agents/activity?limit=$limit'),
    );
    if (response.statusCode != 200) {
      throw Exception('Failed to get agent activity: ${response.statusCode}');
    }
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => AgentActivity.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  /// Create a new user-defined custom agent.
  Future<Map<String, dynamic>> createCustomAgent({
    required String name,
    required String description,
    required String systemPrompt,
    List<String> toolSets = const [],
    String uiPattern = 'chat',
    List<String> suggestions = const [],
  }) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/agents/custom'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'name': name,
        'description': description,
        'system_prompt': systemPrompt,
        'tool_sets': toolSets,
        'ui_pattern': uiPattern,
        'suggestions': suggestions,
      }),
    );
    if (response.statusCode != 200) {
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      throw Exception(body['detail'] ?? 'Failed to create agent');
    }
    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  /// Delete a user-defined custom agent.
  Future<void> deleteCustomAgent(String name) async {
    final response = await _client.delete(
      Uri.parse('$baseUrl/api/agents/custom/$name'),
    );
    if (response.statusCode != 200) {
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      throw Exception(body['detail'] ?? 'Failed to delete agent');
    }
  }

  // --- Schedules (SCOPE.md Feature 3: autonomous background agents) ---

  Future<List<AgentSchedule>> listSchedules({String? agentName}) async {
    var url = '$baseUrl/api/schedules';
    if (agentName != null) url += '?agent_name=$agentName';
    final response = await _client.get(Uri.parse(url));
    if (response.statusCode != 200) {
      throw Exception('Failed to list schedules: ${response.statusCode}');
    }
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((j) => AgentSchedule.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<AgentSchedule> createSchedule({
    required String agentName,
    required String intent,
    String scheduleType = 'interval',
    int intervalMinutes = 60,
    String dailyTime = '09:00',
  }) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/schedules'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'agent_name': agentName,
        'intent': intent,
        'schedule_type': scheduleType,
        'interval_minutes': intervalMinutes,
        'daily_time': dailyTime,
      }),
    );
    if (response.statusCode != 200) {
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      throw Exception(body['detail'] ?? 'Failed to create schedule');
    }
    final data = jsonDecode(response.body) as Map<String, dynamic>;
    return AgentSchedule.fromJson(data['schedule'] as Map<String, dynamic>);
  }

  Future<void> deleteSchedule(String id) async {
    final response = await _client.delete(
      Uri.parse('$baseUrl/api/schedules/$id'),
    );
    if (response.statusCode != 200) {
      throw Exception('Failed to delete schedule: ${response.statusCode}');
    }
  }

  Future<AgentSchedule> toggleSchedule(String id) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/schedules/$id/toggle'),
    );
    if (response.statusCode != 200) {
      throw Exception('Failed to toggle schedule: ${response.statusCode}');
    }
    final data = jsonDecode(response.body) as Map<String, dynamic>;
    // Return a minimal schedule with updated enabled state
    return AgentSchedule(
      id: id,
      agentName: '',
      intent: '',
      enabled: data['enabled'] as bool? ?? true,
    );
  }

  Future<Map<String, dynamic>> schedulerStatus() async {
    final response = await _client.get(
      Uri.parse('$baseUrl/api/schedules/status'),
    );
    if (response.statusCode != 200) {
      throw Exception('Scheduler status failed: ${response.statusCode}');
    }
    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  // --- Tool connections ---

  /// Get connection status for all configured tools (Gmail, GitHub).
  Future<Map<String, dynamic>> toolsStatus() async {
    final response = await _client.get(Uri.parse('$baseUrl/api/tools/status'));
    if (response.statusCode != 200) {
      throw Exception('Tools status check failed: ${response.statusCode}');
    }
    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  /// Get an OAuth connect URL for a provider (gmail, github).
  Future<Map<String, dynamic>> toolConnectUrl(String provider) async {
    final response = await _client.get(
      Uri.parse('$baseUrl/api/tools/connect/$provider'),
    );
    if (response.statusCode != 200) {
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      throw Exception(body['detail'] ?? 'Failed to get connect URL');
    }
    return jsonDecode(response.body) as Map<String, dynamic>;
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
