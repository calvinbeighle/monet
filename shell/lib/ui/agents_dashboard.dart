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
    default:
      return const Color(0xFF888888);
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
      if (mounted) {
        setState(() {
          _agents = agents;
          _recentActivity = activity;
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
                // Agent entity cards
                Wrap(
                  spacing: 16,
                  runSpacing: 16,
                  children: _agents.map((agent) => _buildAgentCard(agent)).toList(),
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

            // Last active
            Text(
              _timeAgo(agent.stats.lastRunAt),
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
