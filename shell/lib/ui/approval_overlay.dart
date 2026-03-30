import 'package:flutter/material.dart';

import '../services/agent_client.dart';

/// Shows a modal dialog when the agent requests approval for a sensitive action.
/// The user must approve or reject before the agent continues.
class ApprovalOverlay extends StatelessWidget {
  final String toolName;
  final Map<String, dynamic> parameters;
  final String approvalId;
  final AgentClient client;
  final VoidCallback onResolved;

  const ApprovalOverlay({
    super.key,
    required this.toolName,
    required this.parameters,
    required this.approvalId,
    required this.client,
    required this.onResolved,
  });

  String get _displayName {
    return toolName.replaceAll('_', ' ');
  }

  String _formatParameters() {
    if (parameters.isEmpty) return 'No parameters';
    return parameters.entries
        .map((e) => '${e.key}: ${e.value}')
        .join('\n');
  }

  Future<void> _approve(BuildContext context) async {
    try {
      await client.approve(approvalId);
    } catch (_) {
      // Backend may have already resolved
    }
    if (context.mounted) {
      Navigator.of(context).pop();
      onResolved();
    }
  }

  Future<void> _reject(BuildContext context) async {
    try {
      await client.reject(approvalId);
    } catch (_) {
      // Backend may have already resolved
    }
    if (context.mounted) {
      Navigator.of(context).pop();
      onResolved();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: const Color(0xFF12121A),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.shield_outlined, color: Color(0xFF7C6EF0), size: 24),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Approval Required',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFF0A0A0F),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _displayName,
                    style: const TextStyle(
                      color: Color(0xFF7C6EF0),
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _formatParameters(),
                    style: const TextStyle(
                      color: Colors.white70,
                      fontSize: 13,
                      fontFamily: 'monospace',
                      height: 1.5,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => _reject(context),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.red.shade300,
                      side: BorderSide(color: Colors.red.shade300.withValues(alpha: 0.5)),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                    child: const Text('Reject'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton(
                    onPressed: () => _approve(context),
                    style: FilledButton.styleFrom(
                      backgroundColor: Colors.green.shade700,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                    child: const Text('Approve'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// Show the approval dialog as a modal.
  static Future<void> show({
    required BuildContext context,
    required String toolName,
    required Map<String, dynamic> parameters,
    required String approvalId,
    required AgentClient client,
    required VoidCallback onResolved,
  }) {
    return showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => ApprovalOverlay(
        toolName: toolName,
        parameters: parameters,
        approvalId: approvalId,
        client: client,
        onResolved: onResolved,
      ),
    );
  }
}
