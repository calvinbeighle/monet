/// See Agents dashboard (SCOPE.md Feature 3).
///
/// Visual dashboard showing all agents as living entities with real-time
/// status, activity feeds, and click-to-detail views. Agents are rendered
/// as cards with personality - not rows in a table.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/agent_client.dart';

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
Color _agentColor(String name) {
  switch (name) {
    case 'email':
      return const Color(0xFF7C6EF0); // purple
    case 'code':
      return const Color(0xFF4EC9B0); // teal
    case 'planning':
      return const Color(0xFFE5A84B); // amber
    case 'general':
      return const Color(0xFF6EA8F0); // blue
    case 'writing':
      return const Color(0xFFE08050); // orange
    default:
      return const Color(0xFFA080D0); // custom agents get a soft violet
  }
}

/// Status indicator color
Color _statusColor(String status) {
  switch (status) {
    case 'working':
      return const Color(0xFF4EC9B0);
    case 'idle':
      return const Color(0xFF666666);
    default:
      return const Color(0xFF666666);
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
    if (_loading && _agents.isEmpty) {
      return const Center(
        child: CircularProgressIndicator(color: Color(0xFF7C6EF0)),
      );
    }

    if (_error != null && _agents.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: Color(0xFF666666), size: 48),
            const SizedBox(height: 16),
            Text(
              'Could not load agents',
              style: TextStyle(color: Colors.white.withAlpha(180), fontSize: 16),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: _loadData,
              child: const Text('Retry', style: TextStyle(color: Color(0xFF7C6EF0))),
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
                  color: Colors.white.withAlpha(220),
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
                    color: const Color(0xFF4EC9B0).withAlpha(30),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const SizedBox(
                        width: 12,
                        height: 12,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Color(0xFF4EC9B0),
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        '${_agents.where((a) => a.stats.currentStatus == 'working').length} working',
                        style: const TextStyle(
                          color: Color(0xFF4EC9B0),
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
                      color: Colors.white.withAlpha(160),
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
    final color = _agentColor(agent.name);
    final icon = _agentIcon(agent.name);
    final status = agent.stats.currentStatus;
    final isWorking = status == 'working';

    return GestureDetector(
      onTap: () => setState(() => _selectedAgent = agent.name),
      child: Container(
        width: 200,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFF12121A),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isWorking ? color.withAlpha(100) : Colors.white.withAlpha(15),
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
                    color: _statusColor(status),
                    shape: BoxShape.circle,
                    boxShadow: isWorking
                        ? [BoxShadow(color: _statusColor(status).withAlpha(100), blurRadius: 6)]
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
                color: Colors.white.withAlpha(220),
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 4),

            // Description
            Text(
              agent.description,
              style: TextStyle(
                color: Colors.white.withAlpha(100),
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
                      color: Colors.white.withAlpha(60),
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
    return GestureDetector(
      onTap: () => _showCreateAgentDialog(),
      child: Container(
        width: 200,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFF12121A),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: Colors.white.withAlpha(15),
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
                color: Colors.white.withAlpha(8),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(Icons.add, color: Colors.white.withAlpha(120), size: 24),
            ),
            const SizedBox(height: 14),
            Text(
              'Create Agent',
              style: TextStyle(
                color: Colors.white.withAlpha(180),
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Build a custom agent with your own instructions',
              style: TextStyle(
                color: Colors.white.withAlpha(80),
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
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          value,
          style: TextStyle(
            color: Colors.white.withAlpha(180),
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(width: 3),
        Text(
          label,
          style: TextStyle(
            color: Colors.white.withAlpha(60),
            fontSize: 11,
          ),
        ),
      ],
    );
  }

  Widget _buildActivityRow(AgentActivity activity) {
    final color = _agentColor(activity.agentName);
    final statusIcon = activity.status == 'completed'
        ? Icons.check_circle_outline
        : activity.status == 'error'
            ? Icons.error_outline
            : Icons.hourglass_top;
    final statusColor = activity.status == 'completed'
        ? const Color(0xFF4EC9B0)
        : activity.status == 'error'
            ? const Color(0xFFE05050)
            : const Color(0xFFE5A84B);

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: const Color(0xFF0E0E14),
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
                  color: Colors.white.withAlpha(160),
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
                color: Colors.white.withAlpha(60),
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
    final agent = _agents.cast<AgentInfo?>().firstWhere(
          (a) => a?.name == agentName,
          orElse: () => null,
        );
    if (agent == null) {
      return const Center(child: Text('Agent not found'));
    }

    final color = _agentColor(agentName);
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
                    color: const Color(0xFF12121A),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(
                    Icons.arrow_back,
                    color: Colors.white.withAlpha(160),
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
                      color: Colors.white.withAlpha(220),
                      fontSize: 18,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Text(
                    agent.description,
                    style: TextStyle(
                      color: Colors.white.withAlpha(100),
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
                      color: const Color(0xFFE05050).withAlpha(15),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Icon(
                      Icons.delete_outline,
                      color: Color(0xFFE05050),
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
                    color: const Color(0xFFA080D0).withAlpha(25),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Text(
                    'Custom',
                    style: TextStyle(
                      color: Color(0xFFA080D0),
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
                  color: _statusColor(agent.stats.currentStatus).withAlpha(25),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  agent.stats.currentStatus[0].toUpperCase() +
                      agent.stats.currentStatus.substring(1),
                  style: TextStyle(
                    color: _statusColor(agent.stats.currentStatus),
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
                    _buildStatCard('Completed', '${agent.stats.completed}', const Color(0xFF4EC9B0)),
                    const SizedBox(width: 12),
                    _buildStatCard('Errors', '${agent.stats.errors}', const Color(0xFFE05050)),
                    const SizedBox(width: 12),
                    _buildStatCard('Tool Calls', '${agent.stats.totalToolCalls}', const Color(0xFF6EA8F0)),
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
                          color: const Color(0xFF12121A),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: needsApproval
                                ? const Color(0xFFE5A84B).withAlpha(60)
                                : Colors.white.withAlpha(10),
                          ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              tool,
                              style: TextStyle(
                                color: Colors.white.withAlpha(160),
                                fontSize: 12,
                                fontFamily: 'monospace',
                              ),
                            ),
                            if (needsApproval) ...[
                              const SizedBox(width: 6),
                              Icon(
                                Icons.shield_outlined,
                                color: const Color(0xFFE5A84B).withAlpha(180),
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
                        color: Colors.white.withAlpha(60),
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
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: const Color(0xFF12121A),
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
                color: Colors.white.withAlpha(80),
                fontSize: 11,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionHeader(String title) {
    return Text(
      title,
      style: TextStyle(
        color: Colors.white.withAlpha(140),
        fontSize: 13,
        fontWeight: FontWeight.w500,
        letterSpacing: 0.5,
      ),
    );
  }

  Widget _buildSchedulesSection(String agentName, Color color) {
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
                color: Colors.white.withAlpha(60),
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
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: const Color(0xFF0E0E14),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: schedule.enabled
                ? color.withAlpha(30)
                : Colors.white.withAlpha(8),
          ),
        ),
        child: Row(
          children: [
            Icon(
              Icons.schedule,
              color: schedule.enabled ? color : Colors.white.withAlpha(40),
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
                      color: Colors.white.withAlpha(schedule.enabled ? 180 : 80),
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
                          : Colors.white.withAlpha(40),
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
                      ? Colors.white.withAlpha(80)
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
                  color: Colors.white.withAlpha(40),
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
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF12121A),
        title: Text(
          'Delete $agentName?',
          style: const TextStyle(color: Colors.white, fontSize: 16),
        ),
        content: Text(
          'This will permanently remove this custom agent and its configuration.',
          style: TextStyle(color: Colors.white.withAlpha(140), fontSize: 14),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: Text('Cancel', style: TextStyle(color: Colors.white.withAlpha(140))),
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
            child: const Text('Delete', style: TextStyle(color: Color(0xFFE05050))),
          ),
        ],
      ),
    );
  }

  Widget _buildDetailActivityRow(AgentActivity activity) {
    final statusColor = activity.status == 'completed'
        ? const Color(0xFF4EC9B0)
        : activity.status == 'error'
            ? const Color(0xFFE05050)
            : const Color(0xFFE5A84B);
    final duration = activity.duration;
    final durationStr = duration != null
        ? '${duration.inSeconds}s'
        : 'running';

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: const Color(0xFF0E0E14),
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
                      color: Colors.white.withAlpha(180),
                      fontSize: 13,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Text(
                  durationStr,
                  style: TextStyle(
                    color: Colors.white.withAlpha(60),
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
                  color: Colors.white.withAlpha(80),
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
                style: const TextStyle(
                  color: Color(0xFFE05050),
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
                    color: Colors.white.withAlpha(40),
                    fontSize: 11,
                  ),
                ),
                if (activity.toolCallsCount > 0) ...[
                  const SizedBox(width: 12),
                  Text(
                    '${activity.toolCallsCount} tool calls',
                    style: TextStyle(
                      color: Colors.white.withAlpha(40),
                      fontSize: 11,
                    ),
                  ),
                ],
                if (activity.approvalsCount > 0) ...[
                  const SizedBox(width: 12),
                  Text(
                    '${activity.approvalsCount} approvals',
                    style: TextStyle(
                      color: Colors.white.withAlpha(40),
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
    return Dialog(
      backgroundColor: const Color(0xFF12121A),
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
                  const Icon(Icons.smart_toy_outlined, color: Color(0xFFA080D0), size: 24),
                  const SizedBox(width: 12),
                  Text(
                    'Create Agent',
                    style: TextStyle(
                      color: Colors.white.withAlpha(220),
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
              Text('Instructions', style: TextStyle(color: Colors.white.withAlpha(140), fontSize: 12)),
              const SizedBox(height: 4),
              TextField(
                controller: _promptController,
                maxLines: 4,
                style: TextStyle(color: Colors.white.withAlpha(200), fontSize: 14),
                decoration: InputDecoration(
                  hintText: 'Tell the agent how to behave...',
                  hintStyle: TextStyle(color: Colors.white.withAlpha(40)),
                  filled: true,
                  fillColor: const Color(0xFF0A0A0F),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: BorderSide(color: Colors.white.withAlpha(15)),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: BorderSide(color: Colors.white.withAlpha(15)),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: const BorderSide(color: Color(0xFFA080D0)),
                  ),
                  contentPadding: const EdgeInsets.all(12),
                ),
              ),
              const SizedBox(height: 16),

              // Tool sets
              Text('Tool Access', style: TextStyle(color: Colors.white.withAlpha(140), fontSize: 12)),
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
                        color: selected ? const Color(0xFFA080D0).withAlpha(25) : const Color(0xFF0A0A0F),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: selected ? const Color(0xFFA080D0).withAlpha(100) : Colors.white.withAlpha(15),
                        ),
                      ),
                      child: Text(
                        entry.value,
                        style: TextStyle(
                          color: selected ? const Color(0xFFA080D0) : Colors.white.withAlpha(100),
                          fontSize: 12,
                        ),
                      ),
                    ),
                  );
                }).toList(),
              ),
              const SizedBox(height: 16),

              // UI pattern
              Text('Default UI', style: TextStyle(color: Colors.white.withAlpha(140), fontSize: 12)),
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
                        color: selected ? const Color(0xFFA080D0).withAlpha(25) : const Color(0xFF0A0A0F),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: selected ? const Color(0xFFA080D0).withAlpha(100) : Colors.white.withAlpha(15),
                        ),
                      ),
                      child: Text(
                        entry.value,
                        style: TextStyle(
                          color: selected ? const Color(0xFFA080D0) : Colors.white.withAlpha(100),
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
                Text(_error!, style: const TextStyle(color: Color(0xFFE05050), fontSize: 12)),
              ],

              const SizedBox(height: 20),

              // Actions
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: _creating ? null : () => Navigator.of(context).pop(),
                    child: Text('Cancel', style: TextStyle(color: Colors.white.withAlpha(140))),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton(
                    onPressed: _creating ? null : _create,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFFA080D0),
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
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: TextStyle(color: Colors.white.withAlpha(140), fontSize: 12)),
        const SizedBox(height: 4),
        TextField(
          controller: controller,
          style: TextStyle(color: Colors.white.withAlpha(200), fontSize: 14),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: TextStyle(color: Colors.white.withAlpha(40)),
            filled: true,
            fillColor: const Color(0xFF0A0A0F),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: BorderSide(color: Colors.white.withAlpha(15)),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: BorderSide(color: Colors.white.withAlpha(15)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: const BorderSide(color: Color(0xFFA080D0)),
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
    return Dialog(
      backgroundColor: const Color(0xFF12121A),
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
                  const Icon(Icons.schedule, color: Color(0xFF7C6EF0), size: 22),
                  const SizedBox(width: 10),
                  Text(
                    'Schedule ${widget.agentName[0].toUpperCase()}${widget.agentName.substring(1)}',
                    style: TextStyle(
                      color: Colors.white.withAlpha(220),
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),

              // Intent field
              Text('What should it do?',
                  style: TextStyle(color: Colors.white.withAlpha(140), fontSize: 12)),
              const SizedBox(height: 4),
              TextField(
                controller: _intentController,
                style: TextStyle(color: Colors.white.withAlpha(200), fontSize: 14),
                decoration: InputDecoration(
                  hintText: 'e.g., Summarize my inbox',
                  hintStyle: TextStyle(color: Colors.white.withAlpha(40)),
                  filled: true,
                  fillColor: const Color(0xFF0A0A0F),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: BorderSide(color: Colors.white.withAlpha(15)),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: BorderSide(color: Colors.white.withAlpha(15)),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: const BorderSide(color: Color(0xFF7C6EF0)),
                  ),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                ),
              ),
              const SizedBox(height: 16),

              // Schedule type
              Text('Frequency',
                  style: TextStyle(color: Colors.white.withAlpha(140), fontSize: 12)),
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
                    style: TextStyle(color: Colors.white.withAlpha(140), fontSize: 12)),
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
                              ? const Color(0xFF7C6EF0).withAlpha(25)
                              : const Color(0xFF0A0A0F),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: selected
                                ? const Color(0xFF7C6EF0).withAlpha(100)
                                : Colors.white.withAlpha(15),
                          ),
                        ),
                        child: Text(
                          entry.value,
                          style: TextStyle(
                            color: selected
                                ? const Color(0xFF7C6EF0)
                                : Colors.white.withAlpha(100),
                            fontSize: 12,
                          ),
                        ),
                      ),
                    );
                  }).toList(),
                ),
              ] else ...[
                Text('Time (24h)',
                    style: TextStyle(color: Colors.white.withAlpha(140), fontSize: 12)),
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
                              ? const Color(0xFF7C6EF0).withAlpha(25)
                              : const Color(0xFF0A0A0F),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: selected
                                ? const Color(0xFF7C6EF0).withAlpha(100)
                                : Colors.white.withAlpha(15),
                          ),
                        ),
                        child: Text(
                          t,
                          style: TextStyle(
                            color: selected
                                ? const Color(0xFF7C6EF0)
                                : Colors.white.withAlpha(100),
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
                Text(_error!, style: const TextStyle(color: Color(0xFFE05050), fontSize: 12)),
              ],

              const SizedBox(height: 20),

              // Actions
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: _creating ? null : () => Navigator.of(context).pop(),
                    child: Text('Cancel',
                        style: TextStyle(color: Colors.white.withAlpha(140))),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton(
                    onPressed: _creating ? null : _create,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF7C6EF0),
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
    final selected = _scheduleType == value;
    return GestureDetector(
      onTap: () => setState(() => _scheduleType = value),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        decoration: BoxDecoration(
          color: selected
              ? const Color(0xFF7C6EF0).withAlpha(25)
              : const Color(0xFF0A0A0F),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: selected
                ? const Color(0xFF7C6EF0).withAlpha(100)
                : Colors.white.withAlpha(15),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected
                ? const Color(0xFF7C6EF0)
                : Colors.white.withAlpha(100),
            fontSize: 13,
          ),
        ),
      ),
    );
  }
}
