/// main.dart
///
/// Entry point for the Monet shell Flutter application.
/// Configures the dark theme, sets up the Provider state management tree,
/// and renders the MonetShell as a fullscreen desktop window.

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'services/session_provider.dart';
import 'ui/shell.dart';

void main() {
  runApp(const MonetApp());
}

/// Root application widget with Provider setup and theme configuration.
class MonetApp extends StatelessWidget {
  const MonetApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => SessionProvider(),
      child: MaterialApp(
        title: 'Monet',
        debugShowCheckedModeBanner: false,
        theme: _buildDarkTheme(),
        home: const MonetShell(),
      ),
    );
  }

  /// Builds the Monet dark theme with consistent colors and typography.
  ThemeData _buildDarkTheme() {
    const background = Color(0xFF0D0D0D);
    const surface = Color(0xFF1A1A1A);
    const accent = Color(0xFF6366F1);
    const onSurface = Color(0xFFE2E2E2);
    const subtle = Color(0xFF555555);

    return ThemeData(
      brightness: Brightness.dark,
      scaffoldBackgroundColor: background,
      colorScheme: const ColorScheme.dark(
        background: background,
        surface: surface,
        primary: accent,
        onBackground: onSurface,
        onSurface: onSurface,
        secondary: accent,
        error: Color(0xFFEF4444),
      ),
      textTheme: const TextTheme(
        bodyLarge: TextStyle(color: onSurface, fontSize: 15),
        bodyMedium: TextStyle(color: onSurface, fontSize: 13),
        bodySmall: TextStyle(color: subtle, fontSize: 11),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surface,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide.none,
        ),
        hintStyle: const TextStyle(color: subtle),
      ),
      scrollbarTheme: ScrollbarThemeData(
        thumbColor: WidgetStateProperty.all(const Color(0xFF333333)),
      ),
    );
  }
}
