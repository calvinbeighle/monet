import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';


import 'services/agent_client.dart';
import 'ui/agents_dashboard.dart';
import 'ui/approval_overlay.dart';
import 'ui/home_screen.dart';
import 'ui/monet_theme.dart';
import 'ui/onboarding.dart';
import 'ui/patterns/chat.dart';
import 'ui/patterns/diff.dart';
import 'ui/patterns/tinder.dart';
import 'ui/patterns/whiteboard.dart';
import 'ui/status_bar.dart';
import 'ui/voice_button.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final themeNotifier = await MonetThemeNotifier.load();
  runApp(MonetApp(themeNotifier: themeNotifier));
}

class MonetApp extends StatefulWidget {
  final MonetThemeNotifier themeNotifier;

  const MonetApp({super.key, required this.themeNotifier});

  @override
  State<MonetApp> createState() => _MonetAppState();
}

class _MonetAppState extends State<MonetApp> {
  bool _authenticated = false;
  bool _checkingSession = true;
  late final AgentClient _agentClient;

  @override
  void initState() {
    super.initState();
    _agentClient = AgentClient();
    _tryRestoreSession();
  }

  Future<void> _tryRestoreSession() async {
    final username = await _agentClient.tryRestoreSession();
    setState(() {
      _authenticated = username != null;
      _checkingSession = false;
    });
  }

  void _onAuthenticated() {
    setState(() => _authenticated = true);
  }

  void _onLogout() async {
    await _agentClient.logout();
    setState(() => _authenticated = false);
  }

  @override
  void dispose() {
    _agentClient.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider<MonetThemeNotifier>.value(
      value: widget.themeNotifier,
      child: Provider<AgentClient>.value(
        value: _agentClient,
        child: Consumer<MonetThemeNotifier>(
          builder: (context, theme, _) {
            final themeData = buildMonetTheme(theme.brightness);
            final colors = theme.isDark ? MonetColors.dark : MonetColors.light;
            return MaterialApp(
              title: 'Monet',
              debugShowCheckedModeBanner: false,
              theme: themeData,
              home: _checkingSession
                  ? Scaffold(
                      backgroundColor: colors.scaffoldBg,
                      body: Center(
                        child: CircularProgressIndicator(color: colors.primary),
                      ),
                    )
                  : _authenticated
                      ? MonetShell(onLogout: _onLogout)
                      : OnboardingScreen(onAuthenticated: _onAuthenticated),
            );
          },
        ),
      ),
    );
  }
}

class MonetShell extends StatefulWidget {
  final VoidCallback? onLogout;

  const MonetShell({super.key, this.onLogout});

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

  // Last intent for retry support
  String? _lastIntent;

  // Index of the current streaming assistant message (null when not streaming tokens)
  int? _streamingMessageIndex;

  // Flow state (cross-pattern flows)
  List<Map<String, dynamic>>? _flowSteps;
  int _flowCurrentStep = 0;
  int _flowTotalSteps = 0;
  bool _awaitingAdvance = false;
  Map<String, dynamic> _carriedState = {};

  StreamSubscription<AgentEvent>? _streamSub;

  // System state (WiFi, volume, brightness)
  SystemStatus _systemStatus = const SystemStatus();
  Timer? _systemPollTimer;

  // Tool connection state (Gmail, GitHub via Nango)
  List<ConnectedTool> _connectedTools = const [
    ConnectedTool(name: 'Gmail', connected: false),
    ConnectedTool(name: 'GitHub', connected: false),
  ];

  @override
  void initState() {
    super.initState();
    _pollSystemState();
    _pollToolStatus();
    // Poll system state every 10 seconds
    _systemPollTimer = Timer.periodic(
      const Duration(seconds: 10),
      (_) {
        _pollSystemState();
        _pollToolStatus();
      },
    );
  }

  Future<void> _pollSystemState() async {
    try {
      final client = context.read<AgentClient>();
      final state = await client.systemState();
      if (mounted) {
        setState(() {
          _systemStatus = SystemStatus.fromJson(state);
        });
      }
    } catch (_) {
      // Backend unreachable - keep last known state
    }
  }

  Future<void> _pollToolStatus() async {
    try {
      final client = context.read<AgentClient>();
      final data = await client.toolsStatus();
      final tools = data['tools'] as List<dynamic>? ?? [];
      if (mounted) {
        setState(() {
          _connectedTools = tools
              .map((t) => ConnectedTool(
                    name: (t as Map<String, dynamic>)['name'] as String? ?? '',
                    connected: t['connected'] as bool? ?? false,
                  ))
              .toList();
        });
      }
    } catch (_) {
      // Backend unreachable - keep last known state
    }
  }

  void _handleWifiTap() {
    // Show WiFi network list in a bottom sheet
    final client = context.read<AgentClient>();
    final c = MonetColors.of(context);
    showModalBottomSheet(
      context: context,
      backgroundColor: c.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(12)),
      ),
      builder: (ctx) => _WifiSheet(client: client, onChanged: _pollSystemState),
    );
  }

  void _handleVolumeTap() async {
    final client = context.read<AgentClient>();
    try {
      final result = await client.volumeMuteToggle();
      if (mounted) {
        setState(() {
          _systemStatus = SystemStatus(
            wifiConnected: _systemStatus.wifiConnected,
            wifiSsid: _systemStatus.wifiSsid,
            wifiSignal: _systemStatus.wifiSignal,
            volumeLevel: result['level'] as int? ?? _systemStatus.volumeLevel,
            volumeMuted: result['muted'] as bool? ?? !_systemStatus.volumeMuted,
            brightnessLevel: _systemStatus.brightnessLevel,
          );
        });
      }
    } catch (_) {}
  }

  void _handleVolumeChanged(int level) async {
    final client = context.read<AgentClient>();
    try {
      await client.volumeSet(level);
      _pollSystemState();
    } catch (_) {}
  }

  void _handleBrightnessChanged(int level) async {
    final client = context.read<AgentClient>();
    try {
      await client.brightnessSet(level);
      _pollSystemState();
    } catch (_) {}
  }

  void _handlePowerTap() {
    final client = context.read<AgentClient>();
    showDialog(
      context: context,
      builder: (ctx) {
        final c = MonetColors.of(ctx);
        return AlertDialog(
          backgroundColor: c.surface,
          title: Text('Power', style: TextStyle(color: c.textPrimary)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _PowerOption(
                icon: Icons.power_settings_new,
                label: 'Shutdown',
                onTap: () {
                  Navigator.of(ctx).pop();
                  client.powerAction('shutdown');
                },
              ),
              const SizedBox(height: 8),
              _PowerOption(
                icon: Icons.restart_alt,
                label: 'Restart',
                onTap: () {
                  Navigator.of(ctx).pop();
                  client.powerAction('restart');
                },
              ),
              const SizedBox(height: 8),
              _PowerOption(
                icon: Icons.bedtime,
                label: 'Suspend',
                onTap: () {
                  Navigator.of(ctx).pop();
                  client.powerAction('suspend');
                },
              ),
            ],
          ),
        );
      },
    );
  }

  /// Track the pattern we were on before opening the agents dashboard,
  /// so we can return to it when the user navigates back.
  String? _preAgentsPattern;

  void _handleAgentsTap() {
    if (_activePattern == 'agents') {
      // Toggle off - return to previous pattern
      setState(() => _activePattern = _preAgentsPattern);
    } else {
      // Toggle on - show agents dashboard
      setState(() {
        _preAgentsPattern = _activePattern;
        _activePattern = 'agents';
      });
    }
  }

  @override
  void dispose() {
    _intentController.dispose();
    _streamSub?.cancel();
    _systemPollTimer?.cancel();
    super.dispose();
  }

  void _retryLastIntent() {
    if (_lastIntent != null && !_isRunning) {
      _submitIntent(_lastIntent!);
    }
  }

  void _submitIntent(String intent) {
    if (intent.trim().isEmpty || _isRunning) return;
    _intentController.clear();
    _lastIntent = intent;

    final client = context.read<AgentClient>();

    setState(() {
      _isRunning = true;
      _chatStreaming = true;
      _chatSuggestions.clear();
      _chatMessages.add(ChatMessage(content: intent, isUser: true));
      // Cancel any active flow when a new intent is submitted
      if (_flowSteps != null) {
        _flowSteps = null;
        _flowCurrentStep = 0;
        _flowTotalSteps = 0;
        _awaitingAdvance = false;
        _carriedState = {};
      }
    });

    _streamSub?.cancel();
    _streamSub = client.stream(intent, sessionId: _sessionId).listen(
      (event) {
        switch (event.type) {
          case 'routing':
            setState(() {
              _activePattern = event.metadata['ui_pattern'] as String?;
              _activeAgent = event.metadata['agent'] as String?;
              _sessionId ??= event.metadata['session_id'] as String?;
              _streamingMessageIndex = null;
            });
          case 'token':
            setState(() {
              if (_streamingMessageIndex == null) {
                _chatMessages.add(ChatMessage(content: event.data, isUser: false));
                _streamingMessageIndex = _chatMessages.length - 1;
              } else {
                _chatMessages[_streamingMessageIndex!].content += event.data;
              }
            });
          case 'tool_call':
            final toolName = event.data;
            setState(() {
              _streamingMessageIndex = null;
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
            if (_activePattern == 'tinder') {
              // In tinder mode, create a swipeable card for each approval
              setState(() {
                _streamingMessageIndex = null;
                final subject = parameters['subject'] as String? ?? '';
                final to = parameters['to'] as String? ?? '';
                final body = parameters['body'] as String? ?? '';
                _tinderCards.add(TinderCard(
                  title: subject.isNotEmpty
                      ? subject
                      : (to.isNotEmpty ? 'Reply to $to' : toolName.replaceAll('_', ' ')),
                  body: body.isNotEmpty ? body : parameters.entries.map((e) => '${e.key}: ${e.value}').join('\n'),
                  metadata: {'approval_id': approvalId, ...parameters},
                ));
              });
              _pendingApprovals.add(_PendingApproval(
                id: approvalId,
                toolName: toolName,
                parameters: parameters,
              ));
            } else if (_activePattern == 'chat' || _activePattern == null) {
              // In chat mode, show inline approval card
              setState(() {
                _streamingMessageIndex = null;
                _chatMessages.add(ChatMessage(
                  content: 'Approve $toolName?',
                  isUser: false,
                  isApproval: true,
                  approvalId: approvalId,
                  toolName: toolName,
                  approvalParameters: parameters,
                ));
              });
              _pendingApprovals.add(_PendingApproval(
                id: approvalId,
                toolName: toolName,
                parameters: parameters,
              ));
            } else {
              _streamingMessageIndex = null;
              _showApprovalDialog(approvalId, toolName, parameters);
            }
          case 'whiteboard_update':
            final nodes = event.metadata['nodes'] as List<dynamic>? ?? [];
            setState(() {
              _whiteboardNodes = nodes
                  .map((o) => WhiteboardNode(
                        id: (o as Map<String, dynamic>)['id'] as String? ?? '',
                        title: o['title'] as String? ?? '',
                        body: o['body'] as String? ?? '',
                        x: (o['x'] as num?)?.toDouble() ?? 0,
                        y: (o['y'] as num?)?.toDouble() ?? 0,
                        priority: o['priority'] as String? ?? 'medium',
                        connections: (o['connections'] as List<dynamic>?)
                                ?.cast<String>() ??
                            [],
                      ))
                  .toList();
            });
          case 'diff_update':
            final lines = event.metadata['lines'] as List<dynamic>? ?? [];
            setState(() {
              _diffLines = lines
                  .map((l) => DiffLine(
                        left: (l as Map<String, dynamic>)['left'] as String?,
                        right: l['right'] as String?,
                        type: _parseDiffType(l['type'] as String?),
                      ))
                  .toList();
            });
          case 'error':
            final retryable = event.metadata['retryable'] == true;
            setState(() {
              _streamingMessageIndex = null;
              _chatMessages.add(ChatMessage(
                content: event.data,
                isUser: false,
                isError: true,
                isRetryable: retryable,
              ));
            });
          case 'flow_start':
            setState(() {
              _flowSteps = (event.metadata['steps'] as List<dynamic>?)
                  ?.cast<Map<String, dynamic>>() ?? [];
              _flowTotalSteps = event.metadata['total_steps'] as int? ?? 0;
              _flowCurrentStep = 0;
            });
          case 'pattern_transition':
            setState(() {
              _flowCurrentStep = event.metadata['step_index'] as int? ?? 0;
              _activePattern = event.metadata['next_pattern'] as String?;
              _activeAgent = event.metadata['next_agent'] as String?;
              _awaitingAdvance = event.metadata['awaiting_advance'] == true;
              _carriedState =
                  (event.metadata['carried_state'] as Map<String, dynamic>?) ?? {};
              _applyCarriedState();
              // Reset streaming state for next step
              _chatStreaming = false;
              _streamingMessageIndex = null;
            });
          case 'flow_done':
            setState(() {
              _flowSteps = null;
              _flowCurrentStep = 0;
              _flowTotalSteps = 0;
              _awaitingAdvance = false;
              _carriedState = {};
              _isRunning = false;
              _chatStreaming = false;
            });
          case 'done':
            final isFlowStepDone = event.metadata['is_flow_step_done'] == true;
            setState(() {
              _chatStreaming = false;
              _streamingMessageIndex = null;
              _applyPatternData(event.metadata);
              final suggestions = event.metadata['suggestions'] as List<dynamic>?;
              _chatSuggestions.clear();
              if (suggestions != null) {
                _chatSuggestions.addAll(suggestions.cast<String>());
              }
              // Only mark as not running if this is a final done (not a flow step done)
              if (!isFlowStepDone) {
                _isRunning = false;
              }
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
                  priority: o['priority'] as String? ?? 'medium',
                  connections: (o['connections'] as List<dynamic>?)
                          ?.cast<String>() ??
                      [],
                ))
            .toList();
    }
  }

  void _applyCarriedState() {
    final cards = _carriedState['cards'] as List<dynamic>?;
    if (cards != null && _activePattern == 'tinder') {
      _tinderCards = cards
          .map((c) => TinderCard(
                title: (c as Map<String, dynamic>)['title'] as String? ?? '',
                body: c['body'] as String? ?? '',
                metadata: c,
              ))
          .toList();
    }

    final context = _carriedState['context'];
    if (context != null && _activePattern == 'chat') {
      _chatMessages.add(ChatMessage(
        content: 'Continuing from previous step with '
            '${context is List ? context.length : 1} items.',
        isUser: false,
        isSystem: true,
      ));
    }
  }

  void _advanceFlow() {
    if (_sessionId == null) return;
    final client = context.read<AgentClient>();
    final userState = _collectCurrentPatternState();
    client.advanceFlow(_sessionId!, _flowCurrentStep, userState);
    setState(() => _awaitingAdvance = false);
  }

  Map<String, dynamic> _collectCurrentPatternState() {
    switch (_activePattern) {
      case 'tinder':
        return {
          'decisions': _tinderCards
              .map((c) => {
                    'title': c.title,
                    'approved': c.metadata['approved'] ?? false,
                  })
              .toList(),
        };
      case 'whiteboard':
        return {
          'nodes': _whiteboardNodes
              .map((n) => {
                    'id': n.id,
                    'title': n.title,
                    'body': n.body,
                    'priority': n.priority,
                  })
              .toList(),
        };
      case 'diff':
        return {
          'diff_decisions': _diffLines
              .map((l) => {
                    'left': l.left,
                    'right': l.right,
                    'type': l.type.name,
                  })
              .toList(),
        };
      default:
        return {};
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

  void _handleNodeTap(String nodeId) {
    // Find the tapped node and send a follow-up intent to expand it into subtasks
    final node = _whiteboardNodes.where((n) => n.id == nodeId).firstOrNull;
    if (node != null && !_isRunning) {
      _submitIntent('Break down "${node.title}" into subtasks');
    }
  }

  void _handleNodeMoved(String nodeId, double x, double y) {
    // Update local state - node positions are already updated by the gesture
    // in WhiteboardPattern, so just trigger a rebuild to update connections
    setState(() {});
  }

  void _handleChatApprovalDecision(String approvalId, bool approved) {
    final client = context.read<AgentClient>();
    if (approved) {
      client.approve(approvalId);
    } else {
      client.reject(approvalId);
    }
    // Update the message status
    setState(() {
      for (final msg in _chatMessages) {
        if (msg.isApproval && msg.approvalId == approvalId) {
          msg.approvalStatus = approved ? 'approved' : 'rejected';
          break;
        }
      }
    });
    _pendingApprovals.removeWhere((a) => a.id == approvalId);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          _buildIntentBar(),
          _buildFlowProgress(),
          Expanded(child: _buildActivePattern()),
          Builder(
            builder: (context) {
              final themeNotifier = context.watch<MonetThemeNotifier>();
              return StatusBar(
                tools: _connectedTools,
                activeAgent: _isRunning ? _activeAgent : null,
                activePattern: _activePattern,
                onLogout: widget.onLogout,
                systemStatus: _systemStatus,
                onWifiTap: _handleWifiTap,
                onVolumeTap: _handleVolumeTap,
                onVolumeChanged: _handleVolumeChanged,
                onBrightnessChanged: _handleBrightnessChanged,
                onPowerTap: _handlePowerTap,
                onAgentsTap: _handleAgentsTap,
                isDarkTheme: themeNotifier.isDark,
                onThemeToggle: themeNotifier.toggle,
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _buildFlowProgress() {
    if (_flowSteps == null || _flowSteps!.isEmpty) return const SizedBox.shrink();
    final c = MonetColors.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: c.surface,
        border: Border(
          bottom: BorderSide(color: c.border),
        ),
      ),
      child: Row(
        children: [
          for (var i = 0; i < _flowTotalSteps; i++) ...[
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: i < _flowCurrentStep
                    ? c.primary
                    : i == _flowCurrentStep
                        ? c.textPrimary
                        : c.textHint,
              ),
            ),
            if (i < _flowTotalSteps - 1)
              Container(
                width: 24,
                height: 1,
                color: i < _flowCurrentStep
                    ? c.primary
                    : c.border,
              ),
          ],
          const SizedBox(width: 12),
          if (_flowCurrentStep < _flowSteps!.length)
            Text(
              _flowSteps![_flowCurrentStep]['label'] as String? ?? '',
              style: TextStyle(
                color: c.textSecondary,
                fontSize: 13,
              ),
            ),
          const Spacer(),
          if (_awaitingAdvance)
            TextButton(
              onPressed: _advanceFlow,
              child: Text(
                'Continue',
                style: TextStyle(color: c.primary),
              ),
            ),
        ],
      ),
    );
  }

  void _handleHomeIntent(String intent) {
    // When user picks a quick action from home, transition to chat as default
    // (the routing event from the backend will set the correct pattern)
    setState(() => _activePattern = 'chat');
    _submitIntent(intent);
  }

  Widget _buildIntentBar() {
    // Hide the intent bar when chat or home pattern is active
    // (chat has its own input, home has quick actions)
    if (_activePattern == null || _activePattern == 'chat') {
      return const SizedBox.shrink();
    }
    final c = MonetColors.of(context);
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      decoration: BoxDecoration(
        color: c.scaffoldBg,
        border: Border(
          bottom: BorderSide(color: c.border),
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: TextField(
          controller: _intentController,
          style: TextStyle(color: c.textPrimary, fontSize: 16),
          decoration: InputDecoration(
            hintText: 'What would you like to do?',
            hintStyle: TextStyle(color: c.textMeta),
            filled: true,
            fillColor: c.surface,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide.none,
            ),
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 20,
              vertical: 14,
            ),
            suffixIcon: _isRunning
                ? Padding(
                    padding: const EdgeInsets.all(12),
                    child: SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: c.primary,
                      ),
                    ),
                  )
                : Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      VoiceButton(
                        onTranscribed: (text) {
                          _intentController.text = text;
                          _submitIntent(text);
                        },
                      ),
                      IconButton(
                        onPressed: () => _submitIntent(_intentController.text),
                        icon: const Icon(Icons.arrow_forward),
                        color: c.primary,
                      ),
                    ],
                  ),
          ),
          onSubmitted: _submitIntent,
          enabled: !_isRunning,
        ),
      ),
    );
  }

  Widget _buildActivePattern() {
    final Widget child;
    switch (_activePattern) {
      case 'tinder':
        child = TinderPattern(
          key: const ValueKey('tinder'),
          cards: _tinderCards,
          onDecision: _handleTinderDecision,
        );
      case 'diff':
        child = DiffPattern(
          key: const ValueKey('diff'),
          lines: _diffLines,
          onDecision: _handleDiffDecision,
        );
      case 'whiteboard':
        child = WhiteboardPattern(
          key: const ValueKey('whiteboard'),
          nodes: _whiteboardNodes,
          onNodeTap: _handleNodeTap,
          onNodeMoved: _handleNodeMoved,
        );
      case 'agents':
        child = const AgentsDashboard(key: ValueKey('agents'));
      case 'chat':
        child = ChatPattern(
          key: const ValueKey('chat'),
          messages: _chatMessages,
          suggestions: _chatSuggestions,
          isStreaming: _chatStreaming && _streamingMessageIndex == null,
          onSend: _submitIntent,
          onSuggestionTap: _submitIntent,
          onApprovalDecision: _handleChatApprovalDecision,
          onRetry: _retryLastIntent,
        );
      default:
        child = HomeScreen(
          key: const ValueKey('home'),
          onIntent: _handleHomeIntent,
          onAgentsTap: _handleAgentsTap,
        );
    }
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 300),
      switchInCurve: Curves.easeOut,
      switchOutCurve: Curves.easeIn,
      child: child,
    );
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

/// WiFi network list bottom sheet.
class _WifiSheet extends StatefulWidget {
  final AgentClient client;
  final VoidCallback onChanged;

  const _WifiSheet({required this.client, required this.onChanged});

  @override
  State<_WifiSheet> createState() => _WifiSheetState();
}

class _WifiSheetState extends State<_WifiSheet> {
  List<Map<String, dynamic>> _networks = [];
  bool _scanning = true;

  @override
  void initState() {
    super.initState();
    _scan();
  }

  Future<void> _scan() async {
    setState(() => _scanning = true);
    try {
      final networks = await widget.client.wifiScan();
      if (mounted) setState(() { _networks = networks; _scanning = false; });
    } catch (_) {
      if (mounted) setState(() => _scanning = false);
    }
  }

  Future<void> _connect(String ssid, String security) async {
    String? password;
    if (security != 'Open' && security.isNotEmpty) {
      password = await _showPasswordDialog(ssid);
      if (password == null) return; // cancelled
    }
    try {
      await widget.client.wifiConnect(ssid, password: password);
      widget.onChanged();
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to connect: $e')),
        );
      }
    }
  }

  Future<String?> _showPasswordDialog(String ssid) {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) {
        final c = MonetColors.of(ctx);
        return AlertDialog(
          backgroundColor: c.surface,
          title: Text('Connect to $ssid',
              style: TextStyle(color: c.textPrimary, fontSize: 16)),
          content: TextField(
            controller: controller,
            obscureText: true,
            style: TextStyle(color: c.textPrimary),
            decoration: InputDecoration(
              hintText: 'Password',
              hintStyle: TextStyle(color: c.textMeta),
            ),
            autofocus: true,
            onSubmitted: (v) => Navigator.of(ctx).pop(v),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: Text('Cancel', style: TextStyle(color: c.textTertiary)),
            ),
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(controller.text),
              child: Text('Connect', style: TextStyle(color: c.primary)),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = MonetColors.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                Text('WiFi Networks',
                    style: TextStyle(
                        color: c.textPrimary,
                        fontSize: 16,
                        fontWeight: FontWeight.w500)),
                const Spacer(),
                if (_scanning)
                  SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: c.primary),
                  )
                else
                  GestureDetector(
                    onTap: _scan,
                    child: Icon(Icons.refresh,
                        size: 18, color: c.textTertiary),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          if (_networks.isEmpty && !_scanning)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text('No networks found',
                  style: TextStyle(color: c.textTertiary)),
            )
          else
            ...List.generate(
              _networks.length > 8 ? 8 : _networks.length,
              (i) {
                final net = _networks[i];
                final ssid = net['ssid'] as String? ?? '';
                final signal = net['signal'] as int? ?? 0;
                final security = net['security'] as String? ?? '';
                final connected = net['connected'] as bool? ?? false;
                return ListTile(
                  dense: true,
                  leading: Icon(
                    signal >= 70 ? Icons.wifi : signal >= 40 ? Icons.wifi_2_bar : Icons.wifi_1_bar,
                    size: 18,
                    color: connected ? c.primary : c.textTertiary,
                  ),
                  title: Text(ssid,
                      style: TextStyle(
                          color: connected ? c.primary : c.textPrimary,
                          fontSize: 14)),
                  subtitle: Text(
                    connected ? 'Connected' : security,
                    style: TextStyle(
                        color: c.textTertiary, fontSize: 11),
                  ),
                  trailing: connected
                      ? Icon(Icons.check, size: 16, color: c.primary)
                      : null,
                  onTap: connected ? null : () => _connect(ssid, security),
                );
              },
            ),
        ],
      ),
    );
  }
}

/// Power menu option row.
class _PowerOption extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _PowerOption({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = MonetColors.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
        child: Row(
          children: [
            Icon(icon, size: 20, color: c.textSecondary),
            const SizedBox(width: 12),
            Text(label,
                style: TextStyle(
                    color: c.textPrimary, fontSize: 14)),
          ],
        ),
      ),
    );
  }
}
