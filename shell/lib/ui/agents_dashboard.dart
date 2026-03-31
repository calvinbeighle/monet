/// See Agents dashboard (SCOPE.md Feature 3).
///
/// Visual dashboard showing all agents as living entities with real-time
/// status, activity feeds, and click-to-detail views. Agents are rendered
/// as cards with personality - not rows in a table.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/agent_client.dart';
import 'monet_theme.dart';

/// Icon mapping for each agent type
IconData _agentIcon(String name) {
  switch (name) {
    case 'email':
      return Icons.email_outlined;
    case 'code':
      return Icons.code;
    case 'planning':
      return Icons.hub_outlined;
    case 'general':
      return Icons.chat_bubble_outline;
    case 'writing':
      return Icons.description_outlined;
    default:
      return Icons.smart_toy_outlined;
  }
}

/// Color mapping for each agent type
Color _agentColor(String name, MonetColors c) {
  switch (name) {
    case 'email':
      return c.agentEmail;
    case 'code':
      return c.agentCode;
    case 'planning':
      return c.agentPlanning;
    case 'general':
      return c.agentGeneral;
    case 'writing':
      return c.agentWriting;
    default:
      return c.agentCustom;
  }
}

/// Status indicator color
Color _statusColor(String status, MonetColors c) {
  switch (status) {
    case 'working':
      return c.success;
    case 'idle':
      return c.textMeta;
    default:
      return c.textMeta;
  }
}

/// Human-readable time ago string from Unix timestamp
String _timeAgo(double? timestamp) {
  if (timestamp == null) return 'Never';
  final now = DateTime.now().millisecondsSinceEpoch / 1000;
  final diff = now - timestamp;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return '${(diff / 60).round()}m ago';
  if (diff < 86400) return '${(diff / 3600).round()}h ago';
  return '${(diff / 86400).round()}d ago';
}

/// The main agents dashboard - shows all agents as visual entity cards.
class AgentsDashboard extends StatefulWidget {
  const AgentsDashboard({super.key});

  @override
  State<AgentsDashboard> createState() => AgentsDashboardState();
}

class AgentsDashboardState extends State<AgentsDashboard> {
  List<AgentInfo> _agents = [];
  List<AgentActivity> _recentActivity = [];
  List<AgentSchedule> _schedules = [];
  bool _loading = true;
  String? _error;
  String? _selectedAgent; // null = overview, non-null = detail view
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _loadData();
    // Poll every 5 seconds for live status updates
    _pollTimer = Timer.periodic(const Duration(seconds: 5), (_) => _loadData());
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadData() async {
    final client = context.read<AgentClient>();
    try {
      final agents = await client.listAgents();
      final activity = await client.agentsActivity(limit: 20);
      final schedules = await client.listSchedules();
      if (mounted) {
        setState(() {
          _agents = agents;
          _recentActivity = activity;
          _schedules = schedules;
          _loading = false;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = MonetColors.of(context);
    if (_loading && _agents.isEmpty) {
      return Center(
        child: CircularProgressIndicator(color: c.primary),
      );
    }

    if (_error != null && _agents.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, color: c.textMeta, size: 48),
            const SizedBox(height: 16),
            Text(
              'Could not load agents',
              style: TextStyle(color: c.textPrimary, fontSize: 16),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: _loadData,
              child: Text('Retry', style: TextStyle(color: c.primary)),
            ),
          ],
        ),
      );
    }

    if (_selectedAgent != null) {
      return _buildAgentDetail(_selectedAgent!);
    }

    return _buildOverview();
  }

  Widget _buildOverview() {
    final c = MonetColors.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Header
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 16),
          child: Row(
            children: [
              Text(
                'Your Agents',
                style: TextStyle(
                  color: c.textPrimary,
                  fontSize: 20,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const Spacer(),
              // Running count badge
              if (_agents.any((a) => a.stats.currentStatus == 'working'))
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: c.success.withAlpha(30),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      SizedBox(
                        width: 12,
                        height: 12,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: c.success,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        '${_agents.where((a) => a.stats.currentStatus == 'working').length} working',
                        style: TextStyle(
                          color: c.success,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),

        // Agent cards grid
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Agent entity cards + Create button
                Wrap(
                  spacing: 16,
                  runSpacing: 16,
                  children: [
                    ..._agents.map((agent) => _buildAgentCard(agent)),
                    _buildCreateAgentCard(),
                  ],
                ),

                const SizedBox(height: 32),

                // Recent activity feed
                if (_recentActivity.isNotEmpty) ...[
                  Text(
                    'Recent Activity',
                    style: TextStyle(
                      color: c.textSecondary,
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: 12),
                  ..._recentActivity.take(10).map(_buildActivityRow),
                ],

                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// Each agent rendered as a visual entity card - not a table row.
  Widget _buildAgentCard(AgentInfo agent) {
    final c = MonetColors.of(context);
    final color = _agentColor(agent.name, c);
    final icon = _agentIcon(agent.name);
    final status = agent.stats.currentStatus;
    final isWorking = status == 'working';

    return GestureDetector(
      onTap: () => setState(() => _selectedAgent = agent.name),
      child: Container(
        width: 200,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: c.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isWorking ? color.withAlpha(100) : c.border,
            width: isWorking ? 1.5 : 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Icon + status indicator
            Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: color.withAlpha(25),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(icon, color: color, size: 24),
                ),
                const Spacer(),
                // Status dot
                Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(
                    color: _statusColor(status, c),
                    shape: BoxShape.circle,
                    boxShadow: isWorking
                        ? [BoxShadow(color: _statusColor(status, c).withAlpha(100), blurRadius: 6)]
                        : null,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),

            // Agent name
            Text(
              agent.name[0].toUpperCase() + agent.name.substring(1),
              style: TextStyle(
                color: c.textPrimary,
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 4),

            // Description
            Text(
              agent.description,
              style: TextStyle(
                color: c.textTertiary,
                fontSize: 12,
                height: 1.3,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 12),

            // Stats row
            Row(
              children: [
                _buildMiniStat('${agent.stats.totalRuns}', 'runs'),
                const SizedBox(width: 12),
                _buildMiniStat('${agent.tools.length}', 'tools'),
              ],
            ),
            const SizedBox(height: 8),

            // Schedule indicator + Last active
            Row(
              children: [
                if (_schedules.any((s) => s.agentName == agent.name && s.enabled)) ...[
                  Icon(Icons.schedule, color: color.withAlpha(140), size: 12),
                  const SizedBox(width: 4),
                  Flexible(
                    child: Text(
                      _schedules
                          .where((s) => s.agentName == agent.name && s.enabled)
                          .first
                          .scheduleLabel,
                      style: TextStyle(color: color.withAlpha(140), fontSize: 11),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ] else
                  Text(
                    _timeAgo(agent.stats.lastRunAt),
                    style: TextStyle(
                      color: c.textMeta,
                      fontSize: 11,
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// "Create Agent" card - opens a dialog to define a new custom agent.
  Widget _buildCreateAgentCard() {
    final c = MonetColors.of(context);
    return GestureDetector(
      onTap: () => _showCreateAgentDialog(),
      child: Container(
        width: 200,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: c.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: c.border,
            width: 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: c.activeOverlay,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(Icons.add, color: c.textSecondary, size: 24),
            ),
            const SizedBox(height: 14),
            Text(
              'Create Agent',
              style: TextStyle(
                color: c.textPrimary,
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Build a custom agent with your own instructions',
              style: TextStyle(
                color: c.textMeta,
                fontSize: 12,
                height: 1.3,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }

  void _showCreateAgentDialog() {
    showDialog(
      context: context,
      builder: (ctx) => _CreateAgentDialog(
        onCreated: () {
          _loadData();
        },
      ),
    );
  }

  Widget _buildMiniStat(String value, String label) {
    final c = MonetColors.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          value,
          style: TextStyle(
            color: c.textPrimary,
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(width: 3),
        Text(
          label,
          style: TextStyle(
            color: c.textMeta,
            fontSize: 11,
          ),
        ),
      ],
    );
  }

  Widget _buildActivityRow(AgentActivity activity) {
    final c = MonetColors.of(context);
    final color = _agentColor(activity.agentName, c);
    final statusIcon = activity.status == 'completed'
        ? Icons.check_circle_outline
        : activity.status == 'error'
            ? Icons.error_outline
            : Icons.hourglass_top;
    final statusColor = activity.status == 'completed'
        ? c.success
        : activity.status == 'error'
            ? c.error
            : c.agentPlanning;

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: c.surfaceTertiary,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          children: [
            Icon(_agentIcon(activity.agentName), color: color, size: 18),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                activity.intent,
                style: TextStyle(
                  color: c.textSecondary,
                  fontSize: 13,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: 8),
            Icon(statusIcon, color: statusColor, size: 16),
            const SizedBox(width: 8),
            Text(
              _timeAgo(activity.startedAt),
              style: TextStyle(
                color: c.textMeta,
                fontSize: 11,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Detail view for a single agent - shows tools, history, config
  Widget _buildAgentDetail(String agentName) {
    final c = MonetColors.of(context);
    final agent = _agents.cast<AgentInfo?>().firstWhere(
          (a) => a?.name == agentName,
          orElse: () => null,
        );
    if (agent == null) {
      return const Center(child: Text('Agent not found'));
    }

    final color = _agentColor(agentName, c);
    final agentActivity =
        _recentActivity.where((a) => a.agentName == agentName).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Back button + header
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
          child: Row(
            children: [
              GestureDetector(
                onTap: () => setState(() => _selectedAgent = null),
                child: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: c.surface,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(
                    Icons.arrow_back,
                    color: c.textSecondary,
                    size: 18,
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: color.withAlpha(25),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(_agentIcon(agentName), color: color, size: 22),
              ),
              const SizedBox(width: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    agentName[0].toUpperCase() + agentName.substring(1),
                    style: TextStyle(
                      color: c.textPrimary,
                      fontSize: 18,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Text(
                    agent.description,
                    style: TextStyle(
                      color: c.textTertiary,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
              const Spacer(),
              // Delete button for custom agents
              if (agent.custom)
                GestureDetector(
                  onTap: () => _confirmDeleteAgent(agent.name),
                  child: Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: c.error.withAlpha(15),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Icon(
                      Icons.delete_outline,
                      color: c.error,
                      size: 18,
                    ),
                  ),
                ),
              if (agent.custom) const SizedBox(width: 8),
              // Custom badge
              if (agent.custom)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: c.agentCustom.withAlpha(25),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    'Custom',
                    style: TextStyle(
                      color: c.agentCustom,
                      fontSize: 11,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              if (agent.custom) const SizedBox(width: 8),
              // Status badge
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: _statusColor(agent.stats.currentStatus, c).withAlpha(25),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  agent.stats.currentStatus[0].toUpperCase() +
                      agent.stats.currentStatus.substring(1),
                  style: TextStyle(
                    color: _statusColor(agent.stats.currentStatus, c),
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
        ),

        const SizedBox(height: 24),

        // Content
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Stats row
                Row(
                  children: [
                    _buildStatCard('Total Runs', '${agent.stats.totalRuns}', color),
                    const SizedBox(width: 12),
                    _buildStatCard('Completed', '${agent.stats.completed}', c.success),
                    const SizedBox(width: 12),
                    _buildStatCard('Errors', '${agent.stats.errors}', c.error),
                    const SizedBox(width: 12),
                    _buildStatCard('Tool Calls', '${agent.stats.totalToolCalls}', c.agentGeneral),
                  ],
                ),
                const SizedBox(height: 24),

                // Schedules section
                _buildSchedulesSection(agentName, color),
                const SizedBox(height: 24),

                // Tools section
                if (agent.tools.isNotEmpty) ...[
                  _buildSectionHeader('Tools'),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: agent.tools.map((tool) {
                      final needsApproval = agent.approvalRequired.contains(tool);
                      return Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        decoration: BoxDecoration(
                          color: c.surface,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: needsApproval
                                ? c.agentPlanning.withAlpha(60)
                                : c.border,
                          ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              tool,
                              style: TextStyle(
                                color: c.textSecondary,
                                fontSize: 12,
                                fontFamily: 'monospace',
                              ),
                            ),
                            if (needsApproval) ...[
                              const SizedBox(width: 6),
                              Icon(
                                Icons.shield_outlined,
                                color: c.agentPlanning.withAlpha(180),
                                size: 14,
                              ),
                            ],
                          ],
                        ),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 24),
                ],

                // Activity feed
                _buildSectionHeader('Activity'),
                const SizedBox(height: 8),
                if (agentActivity.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    child: Text(
                      'No activity yet',
                      style: TextStyle(
                        color: c.textMeta,
                        fontSize: 13,
                      ),
                    ),
                  )
                else
                  ...agentActivity.map(_buildDetailActivityRow),

                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildStatCard(String label, String value, Color color) {
    final c = MonetColors.of(context);
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: c.surface,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              value,
              style: TextStyle(
                color: color,
                fontSize: 22,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(
                color: c.textMeta,
                fontSize: 11,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionHeader(String title) {
    final c = MonetColors.of(context);
    return Text(
      title,
      style: TextStyle(
        color: c.textSecondary,
        fontSize: 13,
        fontWeight: FontWeight.w500,
        letterSpacing: 0.5,
      ),
    );
  }

  Widget _buildSchedulesSection(String agentName, Color color) {
    final c = MonetColors.of(context);
    final agentSchedules = _schedules.where((s) => s.agentName == agentName).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            _buildSectionHeader('Schedules'),
            const Spacer(),
            GestureDetector(
              onTap: () => _showCreateScheduleDialog(agentName),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: color.withAlpha(15),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.add, color: color, size: 14),
                    const SizedBox(width: 4),
                    Text(
                      'Add Schedule',
                      style: TextStyle(color: color, fontSize: 12),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (agentSchedules.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Text(
              'No schedules. Add one to run this agent automatically.',
              style: TextStyle(
                color: c.textMeta,
                fontSize: 13,
              ),
            ),
          )
        else
          ...agentSchedules.map((s) => _buildScheduleRow(s, color)),
      ],
    );
  }

  Widget _buildScheduleRow(AgentSchedule schedule, Color color) {
    final c = MonetColors.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: c.surfaceTertiary,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: schedule.enabled
                ? color.withAlpha(30)
                : c.activeOverlay,
          ),
        ),
        child: Row(
          children: [
            Icon(
              Icons.schedule,
              color: schedule.enabled ? color : c.textHint,
              size: 16,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    schedule.intent,
                    style: TextStyle(
                      color: schedule.enabled ? c.textPrimary : c.textMeta,
                      fontSize: 13,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    schedule.scheduleLabel,
                    style: TextStyle(
                      color: schedule.enabled
                          ? color.withAlpha(140)
                          : c.textHint,
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
            // Toggle enabled
            GestureDetector(
              onTap: () async {
                final client = context.read<AgentClient>();
                try {
                  await client.toggleSchedule(schedule.id);
                  _loadData();
                } catch (_) {}
              },
              child: Container(
                padding: const EdgeInsets.all(6),
                child: Icon(
                  schedule.enabled ? Icons.pause_circle_outline : Icons.play_circle_outline,
                  color: schedule.enabled
                      ? c.textMeta
                      : color.withAlpha(140),
                  size: 20,
                ),
              ),
            ),
            // Delete
            GestureDetector(
              onTap: () async {
                final client = context.read<AgentClient>();
                try {
                  await client.deleteSchedule(schedule.id);
                  _loadData();
                } catch (_) {}
              },
              child: Container(
                padding: const EdgeInsets.all(6),
                child: Icon(
                  Icons.close,
                  color: c.textHint,
                  size: 16,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showCreateScheduleDialog(String agentName) {
    showDialog(
      context: context,
      builder: (ctx) => _CreateScheduleDialog(
        agentName: agentName,
        onCreated: () => _loadData(),
      ),
    );
  }

  void _confirmDeleteAgent(String agentName) {
    final c = MonetColors.of(context);
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: c.surface,
        title: Text(
          'Delete $agentName?',
          style: TextStyle(color: c.textPrimary, fontSize: 16),
        ),
        content: Text(
          'This will permanently remove this custom agent and its configuration.',
          style: TextStyle(color: c.textSecondary, fontSize: 14),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: Text('Cancel', style: TextStyle(color: c.textSecondary)),
          ),
          TextButton(
            onPressed: () async {
              Navigator.of(ctx).pop();
              try {
                final client = context.read<AgentClient>();
                await client.deleteCustomAgent(agentName);
                if (_selectedAgent == agentName) {
                  setState(() => _selectedAgent = null);
                }
                _loadData();
              } catch (e) {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Failed to delete: $e')),
                  );
                }
              }
            },
            child: Text('Delete', style: TextStyle(color: c.error)),
          ),
        ],
      ),
    );
  }

  Widget _buildDetailActivityRow(AgentActivity activity) {
    final c = MonetColors.of(context);
    final statusColor = activity.status == 'completed'
        ? c.success
        : activity.status == 'error'
            ? c.error
            : c.agentPlanning;
    final duration = activity.duration;
    final durationStr = duration != null
        ? '${duration.inSeconds}s'
        : 'running';

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: c.surfaceTertiary,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: statusColor,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    activity.intent,
                    style: TextStyle(
                      color: c.textPrimary,
                      fontSize: 13,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Text(
                  durationStr,
                  style: TextStyle(
                    color: c.textMeta,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
            if (activity.summary != null) ...[
              const SizedBox(height: 6),
              Text(
                activity.summary!,
                style: TextStyle(
                  color: c.textMeta,
                  fontSize: 12,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],
            if (activity.errorMessage != null) ...[
              const SizedBox(height: 6),
              Text(
                activity.errorMessage!,
                style: TextStyle(
                  color: c.error,
                  fontSize: 12,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],
            const SizedBox(height: 4),
            Row(
              children: [
                Text(
                  _timeAgo(activity.startedAt),
                  style: TextStyle(
                    color: c.textHint,
                    fontSize: 11,
                  ),
                ),
                if (activity.toolCallsCount > 0) ...[
                  const SizedBox(width: 12),
                  Text(
                    '${activity.toolCallsCount} tool calls',
                    style: TextStyle(
                      color: c.textHint,
                      fontSize: 11,
                    ),
                  ),
                ],
                if (activity.approvalsCount > 0) ...[
                  const SizedBox(width: 12),
                  Text(
                    '${activity.approvalsCount} approvals',
                    style: TextStyle(
                      color: c.textHint,
                      fontSize: 11,
                    ),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Dialog for creating a new custom agent.
class _CreateAgentDialog extends StatefulWidget {
  final VoidCallback onCreated;

  const _CreateAgentDialog({required this.onCreated});

  @override
  State<_CreateAgentDialog> createState() => _CreateAgentDialogState();
}

class _CreateAgentDialogState extends State<_CreateAgentDialog> {
  final _nameController = TextEditingController();
  final _descController = TextEditingController();
  final _promptController = TextEditingController();
  final Set<String> _selectedToolSets = {};
  String _uiPattern = 'chat';
  bool _creating = false;
  String? _error;

  static const _toolSetLabels = {
    'email': 'Email (Gmail)',
    'code': 'Code (GitHub)',
    'writing': 'Writing (Google Docs)',
  };

  static const _uiPatterns = {
    'chat': 'Chat',
    'tinder': 'Swipe Cards',
    'diff': 'Diff View',
    'whiteboard': 'Whiteboard',
  };

  @override
  void dispose() {
    _nameController.dispose();
    _descController.dispose();
    _promptController.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    final name = _nameController.text.trim().toLowerCase().replaceAll(' ', '-');
    final desc = _descController.text.trim();
    final prompt = _promptController.text.trim();

    if (name.isEmpty || desc.isEmpty || prompt.isEmpty) {
      setState(() => _error = 'All fields are required');
      return;
    }

    setState(() {
      _creating = true;
      _error = null;
    });

    try {
      final client = context.read<AgentClient>();
      await client.createCustomAgent(
        name: name,
        description: desc,
        systemPrompt: prompt,
        toolSets: _selectedToolSets.toList(),
        uiPattern: _uiPattern,
      );
      if (mounted) {
        Navigator.of(context).pop();
        widget.onCreated();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _creating = false;
          _error = e.toString().replaceFirst('Exception: ', '');
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = MonetColors.of(context);
    return Dialog(
      backgroundColor: c.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480, maxHeight: 600),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header
              Row(
                children: [
                  Icon(Icons.smart_toy_outlined, color: c.agentCustom, size: 24),
                  const SizedBox(width: 12),
                  Text(
                    'Create Agent',
                    style: TextStyle(
                      color: c.textPrimary,
                      fontSize: 18,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),

              // Name field
              _buildField('Name', _nameController, 'e.g., morning-briefing'),
              const SizedBox(height: 12),

              // Description field
              _buildField('Description', _descController, 'What does this agent do?'),
              const SizedBox(height: 12),

              // System prompt field (multiline)
              Text('Instructions', style: TextStyle(color: c.textSecondary, fontSize: 12)),
              const SizedBox(height: 4),
              TextField(
                controller: _promptController,
                maxLines: 4,
                style: TextStyle(color: c.textPrimary, fontSize: 14),
                decoration: InputDecoration(
                  hintText: 'Tell the agent how to behave...',
                  hintStyle: TextStyle(color: c.textHint),
                  filled: true,
                  fillColor: c.scaffoldBg,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: BorderSide(color: c.border),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: BorderSide(color: c.border),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: BorderSide(color: c.agentCustom),
                  ),
                  contentPadding: const EdgeInsets.all(12),
                ),
              ),
              const SizedBox(height: 16),

              // Tool sets
              Text('Tool Access', style: TextStyle(color: c.textSecondary, fontSize: 12)),
              const SizedBox(height: 6),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: _toolSetLabels.entries.map((entry) {
                  final selected = _selectedToolSets.contains(entry.key);
                  return GestureDetector(
                    onTap: () => setState(() {
                      if (selected) {
                        _selectedToolSets.remove(entry.key);
                      } else {
                        _selectedToolSets.add(entry.key);
                      }
                    }),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: selected ? c.agentCustom.withAlpha(25) : c.scaffoldBg,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: selected ? c.agentCustom.withAlpha(100) : c.border,
                        ),
                      ),
                      child: Text(
                        entry.value,
                        style: TextStyle(
                          color: selected ? c.agentCustom : c.textTertiary,
                          fontSize: 12,
                        ),
                      ),
                    ),
                  );
                }).toList(),
              ),
              const SizedBox(height: 16),

              // UI pattern
              Text('Default UI', style: TextStyle(color: c.textSecondary, fontSize: 12)),
              const SizedBox(height: 6),
              Wrap(
                spacing: 8,
                children: _uiPatterns.entries.map((entry) {
                  final selected = _uiPattern == entry.key;
                  return GestureDetector(
                    onTap: () => setState(() => _uiPattern = entry.key),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: selected ? c.agentCustom.withAlpha(25) : c.scaffoldBg,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: selected ? c.agentCustom.withAlpha(100) : c.border,
                        ),
                      ),
                      child: Text(
                        entry.value,
                        style: TextStyle(
                          color: selected ? c.agentCustom : c.textTertiary,
                          fontSize: 12,
                        ),
                      ),
                    ),
                  );
                }).toList(),
              ),

              // Error
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!, style: TextStyle(color: c.error, fontSize: 12)),
              ],

              const SizedBox(height: 20),

              // Actions
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: _creating ? null : () => Navigator.of(context).pop(),
                    child: Text('Cancel', style: TextStyle(color: c.textSecondary)),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton(
                    onPressed: _creating ? null : _create,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: c.agentCustom,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                    child: _creating
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('Create'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildField(String label, TextEditingController controller, String hint) {
    final c = MonetColors.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: TextStyle(color: c.textSecondary, fontSize: 12)),
        const SizedBox(height: 4),
        TextField(
          controller: controller,
          style: TextStyle(color: c.textPrimary, fontSize: 14),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: TextStyle(color: c.textHint),
            filled: true,
            fillColor: c.scaffoldBg,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: BorderSide(color: c.border),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: BorderSide(color: c.border),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: BorderSide(color: c.agentCustom),
            ),
            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          ),
        ),
      ],
    );
  }
}

/// Dialog for creating a new schedule for an agent.
class _CreateScheduleDialog extends StatefulWidget {
  final String agentName;
  final VoidCallback onCreated;

  const _CreateScheduleDialog({
    required this.agentName,
    required this.onCreated,
  });

  @override
  State<_CreateScheduleDialog> createState() => _CreateScheduleDialogState();
}

class _CreateScheduleDialogState extends State<_CreateScheduleDialog> {
  final _intentController = TextEditingController();
  String _scheduleType = 'interval';
  int _intervalMinutes = 60;
  String _dailyTime = '09:00';
  bool _creating = false;
  String? _error;

  static const _intervalOptions = {
    15: 'Every 15 min',
    30: 'Every 30 min',
    60: 'Every hour',
    120: 'Every 2 hours',
    360: 'Every 6 hours',
    720: 'Every 12 hours',
    1440: 'Every 24 hours',
  };

  @override
  void dispose() {
    _intentController.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    final intent = _intentController.text.trim();
    if (intent.isEmpty) {
      setState(() => _error = 'Intent is required');
      return;
    }

    setState(() {
      _creating = true;
      _error = null;
    });

    try {
      final client = context.read<AgentClient>();
      await client.createSchedule(
        agentName: widget.agentName,
        intent: intent,
        scheduleType: _scheduleType,
        intervalMinutes: _intervalMinutes,
        dailyTime: _dailyTime,
      );
      if (mounted) {
        Navigator.of(context).pop();
        widget.onCreated();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _creating = false;
          _error = e.toString().replaceFirst('Exception: ', '');
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = MonetColors.of(context);
    return Dialog(
      backgroundColor: c.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420, maxHeight: 480),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header
              Row(
                children: [
                  Icon(Icons.schedule, color: c.primary, size: 22),
                  const SizedBox(width: 10),
                  Text(
                    'Schedule ${widget.agentName[0].toUpperCase()}${widget.agentName.substring(1)}',
                    style: TextStyle(
                      color: c.textPrimary,
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),

              // Intent field
              Text('What should it do?',
                  style: TextStyle(color: c.textSecondary, fontSize: 12)),
              const SizedBox(height: 4),
              TextField(
                controller: _intentController,
                style: TextStyle(color: c.textPrimary, fontSize: 14),
                decoration: InputDecoration(
                  hintText: 'e.g., Summarize my inbox',
                  hintStyle: TextStyle(color: c.textHint),
                  filled: true,
                  fillColor: c.scaffoldBg,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: BorderSide(color: c.border),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: BorderSide(color: c.border),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: BorderSide(color: c.primary),
                  ),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                ),
              ),
              const SizedBox(height: 16),

              // Schedule type
              Text('Frequency',
                  style: TextStyle(color: c.textSecondary, fontSize: 12)),
              const SizedBox(height: 6),
              Row(
                children: [
                  _buildTypeChip('interval', 'Interval'),
                  const SizedBox(width: 8),
                  _buildTypeChip('daily', 'Daily'),
                ],
              ),
              const SizedBox(height: 16),

              // Type-specific options
              if (_scheduleType == 'interval') ...[
                Text('Run every',
                    style: TextStyle(color: c.textSecondary, fontSize: 12)),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: _intervalOptions.entries.map((entry) {
                    final selected = _intervalMinutes == entry.key;
                    return GestureDetector(
                      onTap: () => setState(() => _intervalMinutes = entry.key),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(
                          color: selected
                              ? c.primary.withAlpha(25)
                              : c.scaffoldBg,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: selected
                                ? c.primary.withAlpha(100)
                                : c.border,
                          ),
                        ),
                        child: Text(
                          entry.value,
                          style: TextStyle(
                            color: selected
                                ? c.primary
                                : c.textTertiary,
                            fontSize: 12,
                          ),
                        ),
                      ),
                    );
                  }).toList(),
                ),
              ] else ...[
                Text('Time (24h)',
                    style: TextStyle(color: c.textSecondary, fontSize: 12)),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: ['06:00', '07:00', '08:00', '09:00', '12:00', '17:00', '21:00']
                      .map((t) {
                    final selected = _dailyTime == t;
                    return GestureDetector(
                      onTap: () => setState(() => _dailyTime = t),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(
                          color: selected
                              ? c.primary.withAlpha(25)
                              : c.scaffoldBg,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: selected
                                ? c.primary.withAlpha(100)
                                : c.border,
                          ),
                        ),
                        child: Text(
                          t,
                          style: TextStyle(
                            color: selected
                                ? c.primary
                                : c.textTertiary,
                            fontSize: 12,
                          ),
                        ),
                      ),
                    );
                  }).toList(),
                ),
              ],

              // Error
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!, style: TextStyle(color: c.error, fontSize: 12)),
              ],

              const SizedBox(height: 20),

              // Actions
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: _creating ? null : () => Navigator.of(context).pop(),
                    child: Text('Cancel',
                        style: TextStyle(color: c.textSecondary)),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton(
                    onPressed: _creating ? null : _create,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: c.primary,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(8)),
                    ),
                    child: _creating
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('Create'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildTypeChip(String value, String label) {
    final c = MonetColors.of(context);
    final selected = _scheduleType == value;
    return GestureDetector(
      onTap: () => setState(() => _scheduleType = value),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        decoration: BoxDecoration(
          color: selected
              ? c.primary.withAlpha(25)
              : c.scaffoldBg,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: selected
                ? c.primary.withAlpha(100)
                : c.border,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected
                ? c.primary
                : c.textTertiary,
            fontSize: 13,
          ),
        ),
      ),
    );
  }
}
