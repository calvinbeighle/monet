/// pattern_renderer.dart
///
/// Switches between the four UI patterns (Tinder, Chat, Diff, Whiteboard)
/// based on the active session's uiPattern field. When no session is active
/// a centered welcome screen is displayed.

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../models/agent_event.dart';
import '../../models/session.dart';
import '../../services/session_provider.dart';
import 'chat_pattern.dart';
import 'diff_pattern.dart';
import 'tinder_pattern.dart';
import 'whiteboard_pattern.dart';

/// Central content area that delegates rendering to the active UI pattern.
class PatternRenderer extends StatelessWidget {
  const PatternRenderer({super.key});

  @override
  Widget build(BuildContext context) {
    final sessionProvider = context.watch<SessionProvider>();
    final session = sessionProvider.session;

    // Idle state - show welcome screen
    if (session.status == SessionStatus.idle) {
      return const _WelcomeScreen();
    }

    // Error state
    if (session.status == SessionStatus.error) {
      return _ErrorScreen(message: session.errorMessage ?? 'Unknown error');
    }

    // Connecting state (before we know the pattern)
    if (session.status == SessionStatus.connecting) {
      return const _ConnectingScreen();
    }

    // Active session - render the appropriate pattern
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 200),
      child: _buildPattern(session),
    );
  }

  /// Builds the appropriate pattern widget for the session.
  Widget _buildPattern(Session session) {
    switch (session.uiPattern) {
      case UiPattern.tinder:
        return const TinderPattern(key: ValueKey('tinder'));
      case UiPattern.chat:
        return const ChatPattern(key: ValueKey('chat'));
      case UiPattern.diff:
        return const DiffPattern(key: ValueKey('diff'));
      case UiPattern.whiteboard:
        return const WhiteboardPattern(key: ValueKey('whiteboard'));
      case UiPattern.none:
        // Default to chat for any unknown/unspecified pattern
        return const ChatPattern(key: ValueKey('chat-default'));
    }
  }
}

/// Welcome screen shown when no session is active.
class _WelcomeScreen extends StatelessWidget {
  const _WelcomeScreen();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Logo mark
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: const Color(0xFF6366F1).withOpacity(0.1),
              shape: BoxShape.circle,
              border: Border.all(
                color: const Color(0xFF6366F1).withOpacity(0.3),
                width: 1.5,
              ),
            ),
            child: const Icon(
              Icons.auto_awesome,
              color: Color(0xFF6366F1),
              size: 24,
            ),
          ),
          const SizedBox(height: 20),

          const Text(
            'Monet',
            style: TextStyle(
              color: Color(0xFFE2E2E2),
              fontSize: 24,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(height: 8),

          const Text(
            'Agent Native OS',
            style: TextStyle(
              color: Color(0xFF555555),
              fontSize: 13,
              letterSpacing: 0.3,
            ),
          ),
          const SizedBox(height: 40),

          const Text(
            'Type your intent below to get started',
            style: TextStyle(
              color: Color(0xFF444444),
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}

/// Loading indicator shown while connecting to the agent.
class _ConnectingScreen extends StatelessWidget {
  const _ConnectingScreen();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 28,
            height: 28,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: Color(0xFF6366F1),
            ),
          ),
          SizedBox(height: 16),
          Text(
            'Connecting to agent...',
            style: TextStyle(color: Color(0xFF555555), fontSize: 13),
          ),
        ],
      ),
    );
  }
}

/// Error display screen.
class _ErrorScreen extends StatelessWidget {
  final String message;

  const _ErrorScreen({required this.message});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        constraints: const BoxConstraints(maxWidth: 480),
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: const Color(0xFF1A1A1A),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: const Color(0xFFEF4444).withOpacity(0.3),
            width: 1,
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.error_outline,
              color: Color(0xFFEF4444),
              size: 32,
            ),
            const SizedBox(height: 12),
            const Text(
              'Agent error',
              style: TextStyle(
                color: Color(0xFFE2E2E2),
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              message,
              style: const TextStyle(
                color: Color(0xFF888888),
                fontSize: 13,
                fontFamily: 'monospace',
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            const Text(
              'Press Escape or type a new intent to continue',
              style: TextStyle(color: Color(0xFF444444), fontSize: 11),
            ),
          ],
        ),
      ),
    );
  }
}
