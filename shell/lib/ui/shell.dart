/// shell.dart
///
/// Main shell layout composing the three layers of the Monet desktop:
///   - StatusBar at the top (connection status, agent info)
///   - PatternRenderer in the center (the active UI pattern)
///   - IntentBar at the bottom (persistent input)

import 'package:flutter/material.dart';
import 'intent_bar.dart';
import 'status_bar.dart';
import 'patterns/pattern_renderer.dart';

/// Root layout widget for the Monet shell.
class MonetShell extends StatelessWidget {
  const MonetShell({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D0D0D),
      body: Column(
        children: [
          // Top status bar
          const StatusBar(),

          // Main content area - takes all remaining space
          const Expanded(
            child: PatternRenderer(),
          ),

          // Bottom intent bar
          const IntentBar(),
        ],
      ),
    );
  }
}
