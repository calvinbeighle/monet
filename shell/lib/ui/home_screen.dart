import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:provider/provider.dart';

import '../services/agent_client.dart';
import 'monet_theme.dart';
import 'voice_button.dart';

/// Home screen - the default landing experience after login.
///
/// Shows connected tools, quick actions, agent status, and recent activity
/// so the user sees a desktop-like overview instead of an empty chat.
class HomeScreen extends StatefulWidget {
  final void Function(String intent) onIntent;
  final VoidCallback onAgentsTap;

  const HomeScreen({
    super.key,
    required this.onIntent,
    required this.onAgentsTap,
  });

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Map<String, dynamic>? _summary;
  bool _loading = true;
  Timer? _refreshTimer;

  @override
  void initState() {
    super.initState();
    _loadSummary();
    _refreshTimer = Timer.periodic(
      const Duration(seconds: 15),
      (_) => _loadSummary(),
    );
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadSummary() async {
    try {
      final client = context.read<AgentClient>();
      final data = await client.homeSummary();
      if (mounted) {
        setState(() {
          _summary = data;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    }
  }

  String get _greeting {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  @override
  Widget build(BuildContext context) {
    final c = MonetColors.of(context);
    if (_loading && _summary == null) {
      return Center(
        child: CircularProgressIndicator(color: c.primary),
      );
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 24),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 800),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 24),
              _buildGreeting()
                  .animate()
                  .fadeIn(duration: 400.ms, curve: Curves.easeOut)
                  .slideY(begin: 0.05, end: 0, duration: 400.ms, curve: Curves.easeOut),
              const SizedBox(height: 20),
              _buildVoicePrompt()
                  .animate(delay: 80.ms)
                  .fadeIn(duration: 400.ms, curve: Curves.easeOut)
                  .slideY(begin: 0.08, end: 0, duration: 400.ms, curve: Curves.easeOut),
              const SizedBox(height: 28),
              _buildQuickActions()
                  .animate(delay: 160.ms)
                  .fadeIn(duration: 400.ms, curve: Curves.easeOut)
                  .slideY(begin: 0.08, end: 0, duration: 400.ms, curve: Curves.easeOut),
              const SizedBox(height: 32),
              _buildConnectedTools()
                  .animate(delay: 240.ms)
                  .fadeIn(duration: 400.ms, curve: Curves.easeOut)
                  .slideY(begin: 0.08, end: 0, duration: 400.ms, curve: Curves.easeOut),
              const SizedBox(height: 32),
              _buildAgentOverview()
                  .animate(delay: 320.ms)
                  .fadeIn(duration: 400.ms, curve: Curves.easeOut)
                  .slideY(begin: 0.08, end: 0, duration: 400.ms, curve: Curves.easeOut),
              const SizedBox(height: 32),
              _buildRecentActivity()
                  .animate(delay: 400.ms)
                  .fadeIn(duration: 400.ms, curve: Curves.easeOut)
                  .slideY(begin: 0.08, end: 0, duration: 400.ms, curve: Curves.easeOut),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildGreeting() {
    final c = MonetColors.of(context);
    final client = context.read<AgentClient>();
    final username = client.username ?? 'there';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '$_greeting, $username.',
          style: TextStyle(
            color: c.textPrimary,
            fontSize: 28,
            fontWeight: FontWeight.w300,
            letterSpacing: -0.5,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          'What would you like to work on?',
          style: TextStyle(
            color: c.textTertiary,
            fontSize: 16,
          ),
        ),
      ],
    );
  }

  Widget _buildVoicePrompt() {
    final c = MonetColors.of(context);
    return Center(
      child: Column(
        children: [
          VoiceButton(
            large: true,
            onTranscribed: (text) => widget.onIntent(text),
          ),
          const SizedBox(height: 8),
          Text(
            'Hold to speak',
            style: TextStyle(
              color: c.textMeta,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildQuickActions() {
    final actions = (_summary?['quick_actions'] as List<dynamic>?) ?? [];
    if (actions.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionHeader('Quick actions'),
        const SizedBox(height: 12),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: actions.map((a) {
            final action = a as Map<String, dynamic>;
            final label = action['label'] as String? ?? '';
            final iconName = action['icon'] as String? ?? 'arrow_forward';
            final intent = action['intent'] as String? ?? '';
            return _QuickActionChip(
              label: label,
              icon: _iconFromName(iconName),
              onTap: () => widget.onIntent(intent),
            );
          }).toList(),
        ),
      ],
    );
  }

  Widget _buildConnectedTools() {
    final c = MonetColors.of(context);
    final tools = (_summary?['tools'] as List<dynamic>?) ?? [];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionHeader('Connected tools'),
        const SizedBox(height: 12),
        Row(
          children: [
            for (var i = 0; i < tools.length; i++) ...[
              Expanded(
                child: _ToolCard(
                  name: (tools[i] as Map<String, dynamic>)['name'] as String? ?? '',
                  provider: (tools[i] as Map<String, dynamic>)['provider'] as String? ?? '',
                  connected: (tools[i] as Map<String, dynamic>)['connected'] as bool? ?? false,
                ),
              ),
              if (i < tools.length - 1) const SizedBox(width: 10),
            ],
            if (tools.isEmpty)
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: c.surface,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: c.hoverOverlay,
                    ),
                  ),
                  child: Text(
                    'No tools connected yet. Connect Gmail, GitHub, or Google Docs to get started.',
                    style: TextStyle(
                      color: c.textTertiary,
                      fontSize: 13,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ],
    );
  }

  Widget _buildAgentOverview() {
    final c = MonetColors.of(context);
    final agents = (_summary?['agents'] as List<dynamic>?) ?? [];
    final activeSchedules = _summary?['active_schedules'] as int? ?? 0;

    final workingCount = agents.where((a) {
      final stats = (a as Map<String, dynamic>)['stats'] as Map<String, dynamic>?;
      return (stats?['running'] as int? ?? 0) > 0;
    }).length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            _sectionHeader('Agents'),
            const SizedBox(width: 8),
            if (workingCount > 0)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: c.primary.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '$workingCount active',
                  style: TextStyle(
                    color: c.primary,
                    fontSize: 11,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            if (activeSchedules > 0) ...[
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: c.borderSubtle,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '$activeSchedules scheduled',
                  style: TextStyle(
                    color: c.textTertiary,
                    fontSize: 11,
                  ),
                ),
              ),
            ],
            const Spacer(),
            GestureDetector(
              onTap: widget.onAgentsTap,
              child: Text(
                'View all',
                style: TextStyle(
                  color: c.primary.withValues(alpha: 0.8),
                  fontSize: 13,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: agents.take(6).map((a) {
            final agent = a as Map<String, dynamic>;
            final name = agent['name'] as String? ?? '';
            final description = agent['description'] as String? ?? '';
            final stats = agent['stats'] as Map<String, dynamic>?;
            final running = (stats?['running'] as int? ?? 0) > 0;
            final totalRuns = stats?['total_runs'] as int? ?? 0;
            final custom = agent['custom'] as bool? ?? false;
            return _AgentMiniCard(
              name: name,
              description: description,
              isWorking: running,
              totalRuns: totalRuns,
              isCustom: custom,
              onTap: widget.onAgentsTap,
            );
          }).toList(),
        ),
      ],
    );
  }

  Widget _buildRecentActivity() {
    final c = MonetColors.of(context);
    final activity = (_summary?['recent_activity'] as List<dynamic>?) ?? [];
    if (activity.isEmpty) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _sectionHeader('Recent activity'),
          const SizedBox(height: 12),
          Text(
            'No activity yet. Try a quick action above to get started.',
            style: TextStyle(
              color: c.textMeta,
              fontSize: 13,
            ),
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionHeader('Recent activity'),
        const SizedBox(height: 12),
        ...activity.map((a) {
          final item = a as Map<String, dynamic>;
          final agentName = item['agent_name'] as String? ?? '';
          final intent = item['intent'] as String? ?? '';
          final status = item['status'] as String? ?? '';
          final startedAt = (item['started_at'] as num?)?.toDouble() ?? 0;
          return _ActivityRow(
            agentName: agentName,
            intent: intent,
            status: status,
            startedAt: startedAt,
            onTap: () => widget.onIntent(intent),
          );
        }),
      ],
    );
  }

  Widget _sectionHeader(String text) {
    final c = MonetColors.of(context);
    return Text(
      text,
      style: TextStyle(
        color: c.textTertiary,
        fontSize: 12,
        fontWeight: FontWeight.w600,
        letterSpacing: 1.0,
      ),
    );
  }

  IconData _iconFromName(String name) {
    switch (name) {
      case 'inbox':
        return Icons.inbox;
      case 'edit':
        return Icons.edit_outlined;
      case 'code':
        return Icons.code;
      case 'folder':
        return Icons.folder_outlined;
      case 'description':
        return Icons.description_outlined;
      case 'search':
        return Icons.search;
      case 'calendar_today':
        return Icons.calendar_today;
      case 'help':
        return Icons.help_outline;
      default:
        return Icons.arrow_forward;
    }
  }
}

/// Quick action chip - tappable pill that fires an intent.
class _QuickActionChip extends StatefulWidget {
  final String label;
  final IconData icon;
  final VoidCallback onTap;

  const _QuickActionChip({
    required this.label,
    required this.icon,
    required this.onTap,
  });

  @override
  State<_QuickActionChip> createState() => _QuickActionChipState();
}

class _QuickActionChipState extends State<_QuickActionChip> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final c = MonetColors.of(context);
    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: GestureDetector(
        onTap: widget.onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
            color: _hovered
                ? c.primary.withValues(alpha: 0.12)
                : c.surface,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: _hovered
                  ? c.primary.withValues(alpha: 0.3)
                  : c.activeOverlay,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                widget.icon,
                size: 16,
                color: _hovered
                    ? c.primary
                    : c.textTertiary,
              ),
              const SizedBox(width: 8),
              Text(
                widget.label,
                style: TextStyle(
                  color: _hovered
                      ? c.textPrimary
                      : c.textSecondary,
                  fontSize: 13,
                  fontWeight: FontWeight.w400,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Connected tool card showing name, provider icon, and connection status.
class _ToolCard extends StatelessWidget {
  final String name;
  final String provider;
  final bool connected;

  const _ToolCard({
    required this.name,
    required this.provider,
    required this.connected,
  });

  IconData get _icon {
    switch (provider) {
      case 'gmail':
        return Icons.email_outlined;
      case 'github':
        return Icons.code;
      case 'google-docs':
        return Icons.description_outlined;
      default:
        return Icons.extension;
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = MonetColors.of(context);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: connected
              ? c.primary.withValues(alpha: 0.2)
              : c.hoverOverlay,
        ),
      ),
      child: Row(
        children: [
          Icon(
            _icon,
            size: 20,
            color: connected
                ? c.primary
                : c.textMeta,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: TextStyle(
                    color: c.textPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  connected ? 'Connected' : 'Not connected',
                  style: TextStyle(
                    color: connected
                        ? c.primary.withValues(alpha: 0.7)
                        : c.textMeta,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: connected
                  ? c.success
                  : c.border,
            ),
          ),
        ],
      ),
    );
  }
}

/// Compact agent card for the home screen overview.
class _AgentMiniCard extends StatefulWidget {
  final String name;
  final String description;
  final bool isWorking;
  final int totalRuns;
  final bool isCustom;
  final VoidCallback onTap;

  const _AgentMiniCard({
    required this.name,
    required this.description,
    required this.isWorking,
    required this.totalRuns,
    required this.isCustom,
    required this.onTap,
  });

  @override
  State<_AgentMiniCard> createState() => _AgentMiniCardState();
}

class _AgentMiniCardState extends State<_AgentMiniCard> {
  bool _hovered = false;

  IconData get _icon {
    switch (widget.name) {
      case 'email':
        return Icons.email_outlined;
      case 'code':
        return Icons.code;
      case 'planning':
        return Icons.map_outlined;
      case 'writing':
        return Icons.edit_note;
      case 'general':
        return Icons.chat_outlined;
      default:
        return widget.isCustom ? Icons.auto_awesome : Icons.smart_toy_outlined;
    }
  }

  Color _accentColor(MonetColors c) {
    switch (widget.name) {
      case 'email':
        return c.agentEmail;
      case 'code':
        return c.agentCode;
      case 'planning':
        return c.agentPlanning;
      case 'writing':
        return c.agentWriting;
      case 'general':
        return c.primary;
      default:
        return c.agentCustom;
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = MonetColors.of(context);
    final accentColor = _accentColor(c);
    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: GestureDetector(
        onTap: widget.onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          width: 170,
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: _hovered
                ? accentColor.withValues(alpha: 0.06)
                : c.surface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: _hovered
                  ? accentColor.withValues(alpha: 0.2)
                  : c.hoverOverlay,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(_icon, size: 18, color: accentColor),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      widget.name,
                      style: TextStyle(
                        color: c.textPrimary,
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (widget.isWorking)
                    Container(
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: c.success,
                        boxShadow: [
                          BoxShadow(
                            color: c.success.withValues(alpha: 0.4),
                            blurRadius: 4,
                          ),
                        ],
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                widget.description,
                style: TextStyle(
                  color: c.textHint,
                  fontSize: 11,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              if (widget.totalRuns > 0) ...[
                const SizedBox(height: 6),
                Text(
                  '${widget.totalRuns} runs',
                  style: TextStyle(
                    color: c.textHint,
                    fontSize: 10,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Single row in the recent activity feed.
class _ActivityRow extends StatefulWidget {
  final String agentName;
  final String intent;
  final String status;
  final double startedAt;
  final VoidCallback onTap;

  const _ActivityRow({
    required this.agentName,
    required this.intent,
    required this.status,
    required this.startedAt,
    required this.onTap,
  });

  @override
  State<_ActivityRow> createState() => _ActivityRowState();
}

class _ActivityRowState extends State<_ActivityRow> {
  bool _hovered = false;

  IconData get _statusIcon {
    switch (widget.status) {
      case 'completed':
        return Icons.check_circle_outline;
      case 'error':
        return Icons.error_outline;
      case 'running':
        return Icons.hourglass_top;
      default:
        return Icons.circle_outlined;
    }
  }

  Color _statusColor(MonetColors c) {
    switch (widget.status) {
      case 'completed':
        return c.success;
      case 'error':
        return c.agentEmail;
      case 'running':
        return c.primary;
      default:
        return c.textMeta;
    }
  }

  String get _timeAgo {
    final now = DateTime.now().millisecondsSinceEpoch / 1000;
    final diff = (now - widget.startedAt).round();
    if (diff < 60) return 'just now';
    if (diff < 3600) return '${diff ~/ 60}m ago';
    if (diff < 86400) return '${diff ~/ 3600}h ago';
    return '${diff ~/ 86400}d ago';
  }

  @override
  Widget build(BuildContext context) {
    final c = MonetColors.of(context);
    final statusColor = _statusColor(c);
    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: GestureDetector(
        onTap: widget.onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 100),
          padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 12),
          decoration: BoxDecoration(
            color: _hovered
                ? c.borderSubtle
                : Colors.transparent,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            children: [
              Icon(_statusIcon, size: 16, color: statusColor),
              const SizedBox(width: 10),
              Text(
                widget.agentName,
                style: TextStyle(
                  color: c.textTertiary,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  widget.intent,
                  style: TextStyle(
                    color: c.textSecondary,
                    fontSize: 13,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                _timeAgo,
                style: TextStyle(
                  color: c.textHint,
                  fontSize: 11,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
