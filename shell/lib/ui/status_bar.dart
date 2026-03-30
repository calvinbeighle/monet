/// status_bar.dart
///
/// Thin top bar showing the Monet wordmark on the left and a live
/// connection indicator dot on the right. The dot is green when the
/// backend is reachable and red otherwise.

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/session_provider.dart';

/// Height of the status bar in logical pixels.
const double kStatusBarHeight = 32.0;

/// Top-level status bar widget for the Monet shell.
class StatusBar extends StatelessWidget {
  const StatusBar({super.key});

  @override
  Widget build(BuildContext context) {
    final sessionProvider = context.watch<SessionProvider>();
    final isConnected = sessionProvider.isBackendConnected;
    final session = sessionProvider.session;

    return Container(
      height: kStatusBarHeight,
      color: const Color(0xFF111111),
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: [
          // Wordmark
          const Text(
            'Monet',
            style: TextStyle(
              color: Color(0xFFE2E2E2),
              fontSize: 13,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.5,
            ),
          ),

          const Spacer(),

          // Agent name if session is active
          if (session.agentName != null && session.isActive)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Text(
                session.agentName!,
                style: const TextStyle(
                  color: Color(0xFF888888),
                  fontSize: 11,
                ),
              ),
            ),

          // Connection status dot
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: isConnected
                  ? const Color(0xFF22C55E)
                  : const Color(0xFFEF4444),
              boxShadow: isConnected
                  ? [
                      BoxShadow(
                        color: const Color(0xFF22C55E).withOpacity(0.5),
                        blurRadius: 4,
                      ),
                    ]
                  : null,
            ),
          ),
        ],
      ),
    );
  }
}
