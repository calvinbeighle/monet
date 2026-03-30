import 'package:flutter/material.dart';

class ConnectedTool {
  final String name;
  final bool connected;

  const ConnectedTool({required this.name, required this.connected});
}

class StatusBar extends StatelessWidget {
  final List<ConnectedTool> tools;
  final String? activeAgent;
  final String? activePattern;

  const StatusBar({
    super.key,
    this.tools = const [],
    this.activeAgent,
    this.activePattern,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 36,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: const Color(0xFF0A0A0F),
        border: Border(
          top: BorderSide(color: Colors.white.withValues(alpha: 0.1)),
        ),
      ),
      child: Row(
        children: [
          ...tools.map(_buildToolIndicator),
          const Spacer(),
          if (activeAgent != null) _buildAgentIndicator(),
          if (activePattern != null) ...[
            const SizedBox(width: 12),
            _buildPatternBadge(),
          ],
        ],
      ),
    );
  }

  Widget _buildToolIndicator(ConnectedTool tool) {
    return Padding(
      padding: const EdgeInsets.only(right: 12),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: tool.connected ? Colors.green : Colors.grey,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            tool.name,
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.5),
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAgentIndicator() {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: 12,
          height: 12,
          child: CircularProgressIndicator(
            strokeWidth: 1.5,
            color: const Color(0xFF7C6EF0),
          ),
        ),
        const SizedBox(width: 8),
        Text(
          activeAgent!,
          style: TextStyle(
            color: const Color(0xFF7C6EF0),
            fontSize: 12,
          ),
        ),
      ],
    );
  }

  Widget _buildPatternBadge() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(4),
        color: Colors.white.withValues(alpha: 0.08),
      ),
      child: Text(
        activePattern!,
        style: TextStyle(
          color: Colors.white.withValues(alpha: 0.5),
          fontSize: 11,
        ),
      ),
    );
  }
}
