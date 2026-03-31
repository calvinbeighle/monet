import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Semantic color tokens for the Monet OS theme.
///
/// All widgets should use MonetColors.of(context) instead of hardcoded Color()
/// values so they respond to dark/light theme switching.
class MonetColors extends ThemeExtension<MonetColors> {
  // Backgrounds
  final Color scaffoldBg;
  final Color surface;
  final Color surfaceSecondary;
  final Color surfaceTertiary;
  final Color errorSurface;

  // Primary accent (purple)
  final Color primary;

  // Text hierarchy
  final Color textPrimary;
  final Color textSecondary;
  final Color textTertiary;
  final Color textMeta;
  final Color textHint;

  // Borders
  final Color border;
  final Color borderSubtle;

  // Interactive overlays
  final Color hoverOverlay;
  final Color activeOverlay;

  // Status
  final Color success;
  final Color error;

  // Agent accent colors (same in both themes)
  final Color agentEmail;
  final Color agentCode;
  final Color agentPlanning;
  final Color agentWriting;
  final Color agentGeneral;
  final Color agentCustom;

  const MonetColors({
    required this.scaffoldBg,
    required this.surface,
    required this.surfaceSecondary,
    required this.surfaceTertiary,
    required this.errorSurface,
    required this.primary,
    required this.textPrimary,
    required this.textSecondary,
    required this.textTertiary,
    required this.textMeta,
    required this.textHint,
    required this.border,
    required this.borderSubtle,
    required this.hoverOverlay,
    required this.activeOverlay,
    required this.success,
    required this.error,
    required this.agentEmail,
    required this.agentCode,
    required this.agentPlanning,
    required this.agentWriting,
    required this.agentGeneral,
    required this.agentCustom,
  });

  static const dark = MonetColors(
    scaffoldBg: Color(0xFF0A0A0F),
    surface: Color(0xFF12121A),
    surfaceSecondary: Color(0xFF1A1A25),
    surfaceTertiary: Color(0xFF0E0E14),
    errorSurface: Color(0xFF1A1215),
    primary: Color(0xFF7C6EF0),
    textPrimary: Color(0xCCFFFFFF),       // white 80%
    textSecondary: Color(0x99FFFFFF),     // white 60%
    textTertiary: Color(0x66FFFFFF),      // white 40%
    textMeta: Color(0x4DFFFFFF),          // white 30%
    textHint: Color(0x33FFFFFF),          // white 20%
    border: Color(0x1AFFFFFF),            // white 10%
    borderSubtle: Color(0x0DFFFFFF),      // white 5%
    hoverOverlay: Color(0x0FFFFFFF),      // white 6%
    activeOverlay: Color(0x14FFFFFF),     // white 8%
    success: Color(0xFF4ADE80),
    error: Color(0xFFE05050),
    agentEmail: Color(0xFFE06C75),
    agentCode: Color(0xFF61AFEF),
    agentPlanning: Color(0xFFC678DD),
    agentWriting: Color(0xFF98C379),
    agentGeneral: Color(0xFF7C6EF0),
    agentCustom: Color(0xFFA080D0),
  );

  static const light = MonetColors(
    scaffoldBg: Color(0xFFF5F5FA),
    surface: Color(0xFFFFFFFF),
    surfaceSecondary: Color(0xFFF0F0F6),
    surfaceTertiary: Color(0xFFE8E8F0),
    errorSurface: Color(0xFFFDF0F0),
    primary: Color(0xFF6B5DD3),           // slightly deeper purple for contrast on light bg
    textPrimary: Color(0xD9000000),       // black 85%
    textSecondary: Color(0xA6000000),     // black 65%
    textTertiary: Color(0x73000000),      // black 45%
    textMeta: Color(0x4D000000),          // black 30%
    textHint: Color(0x33000000),          // black 20%
    border: Color(0x1A000000),            // black 10%
    borderSubtle: Color(0x0D000000),      // black 5%
    hoverOverlay: Color(0x0F000000),      // black 6%
    activeOverlay: Color(0x14000000),     // black 8%
    success: Color(0xFF16A34A),           // darker green for light bg
    error: Color(0xFFDC2626),
    agentEmail: Color(0xFFDC4A55),
    agentCode: Color(0xFF3B8BDB),
    agentPlanning: Color(0xFFAB5BC0),
    agentWriting: Color(0xFF6FA050),
    agentGeneral: Color(0xFF6B5DD3),
    agentCustom: Color(0xFF8B60C0),
  );

  /// Convenience accessor.
  static MonetColors of(BuildContext context) {
    return Theme.of(context).extension<MonetColors>()!;
  }

  @override
  MonetColors copyWith({
    Color? scaffoldBg,
    Color? surface,
    Color? surfaceSecondary,
    Color? surfaceTertiary,
    Color? errorSurface,
    Color? primary,
    Color? textPrimary,
    Color? textSecondary,
    Color? textTertiary,
    Color? textMeta,
    Color? textHint,
    Color? border,
    Color? borderSubtle,
    Color? hoverOverlay,
    Color? activeOverlay,
    Color? success,
    Color? error,
    Color? agentEmail,
    Color? agentCode,
    Color? agentPlanning,
    Color? agentWriting,
    Color? agentGeneral,
    Color? agentCustom,
  }) {
    return MonetColors(
      scaffoldBg: scaffoldBg ?? this.scaffoldBg,
      surface: surface ?? this.surface,
      surfaceSecondary: surfaceSecondary ?? this.surfaceSecondary,
      surfaceTertiary: surfaceTertiary ?? this.surfaceTertiary,
      errorSurface: errorSurface ?? this.errorSurface,
      primary: primary ?? this.primary,
      textPrimary: textPrimary ?? this.textPrimary,
      textSecondary: textSecondary ?? this.textSecondary,
      textTertiary: textTertiary ?? this.textTertiary,
      textMeta: textMeta ?? this.textMeta,
      textHint: textHint ?? this.textHint,
      border: border ?? this.border,
      borderSubtle: borderSubtle ?? this.borderSubtle,
      hoverOverlay: hoverOverlay ?? this.hoverOverlay,
      activeOverlay: activeOverlay ?? this.activeOverlay,
      success: success ?? this.success,
      error: error ?? this.error,
      agentEmail: agentEmail ?? this.agentEmail,
      agentCode: agentCode ?? this.agentCode,
      agentPlanning: agentPlanning ?? this.agentPlanning,
      agentWriting: agentWriting ?? this.agentWriting,
      agentGeneral: agentGeneral ?? this.agentGeneral,
      agentCustom: agentCustom ?? this.agentCustom,
    );
  }

  @override
  MonetColors lerp(MonetColors? other, double t) {
    if (other is! MonetColors) return this;
    return MonetColors(
      scaffoldBg: Color.lerp(scaffoldBg, other.scaffoldBg, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      surfaceSecondary: Color.lerp(surfaceSecondary, other.surfaceSecondary, t)!,
      surfaceTertiary: Color.lerp(surfaceTertiary, other.surfaceTertiary, t)!,
      errorSurface: Color.lerp(errorSurface, other.errorSurface, t)!,
      primary: Color.lerp(primary, other.primary, t)!,
      textPrimary: Color.lerp(textPrimary, other.textPrimary, t)!,
      textSecondary: Color.lerp(textSecondary, other.textSecondary, t)!,
      textTertiary: Color.lerp(textTertiary, other.textTertiary, t)!,
      textMeta: Color.lerp(textMeta, other.textMeta, t)!,
      textHint: Color.lerp(textHint, other.textHint, t)!,
      border: Color.lerp(border, other.border, t)!,
      borderSubtle: Color.lerp(borderSubtle, other.borderSubtle, t)!,
      hoverOverlay: Color.lerp(hoverOverlay, other.hoverOverlay, t)!,
      activeOverlay: Color.lerp(activeOverlay, other.activeOverlay, t)!,
      success: Color.lerp(success, other.success, t)!,
      error: Color.lerp(error, other.error, t)!,
      agentEmail: Color.lerp(agentEmail, other.agentEmail, t)!,
      agentCode: Color.lerp(agentCode, other.agentCode, t)!,
      agentPlanning: Color.lerp(agentPlanning, other.agentPlanning, t)!,
      agentWriting: Color.lerp(agentWriting, other.agentWriting, t)!,
      agentGeneral: Color.lerp(agentGeneral, other.agentGeneral, t)!,
      agentCustom: Color.lerp(agentCustom, other.agentCustom, t)!,
    );
  }
}

/// Builds complete ThemeData for dark or light mode.
ThemeData buildMonetTheme(Brightness brightness) {
  final colors = brightness == Brightness.dark ? MonetColors.dark : MonetColors.light;
  final isDark = brightness == Brightness.dark;

  return ThemeData(
    brightness: brightness,
    scaffoldBackgroundColor: colors.scaffoldBg,
    fontFamily: 'Inter',
    colorScheme: isDark
        ? ColorScheme.dark(
            surface: colors.surface,
            primary: colors.primary,
          )
        : ColorScheme.light(
            surface: colors.surface,
            primary: colors.primary,
          ),
    extensions: [colors],
  );
}

/// Manages dark/light theme state with SharedPreferences persistence.
class MonetThemeNotifier extends ChangeNotifier {
  static const _key = 'monet_theme_dark';

  bool _isDark;
  MonetThemeNotifier({bool isDark = true}) : _isDark = isDark;

  bool get isDark => _isDark;
  Brightness get brightness => _isDark ? Brightness.dark : Brightness.light;

  void toggle() {
    _isDark = !_isDark;
    notifyListeners();
    _persist();
  }

  void setDark(bool value) {
    if (_isDark == value) return;
    _isDark = value;
    notifyListeners();
    _persist();
  }

  Future<void> _persist() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_key, _isDark);
  }

  /// Load saved preference. Call once at startup.
  static Future<MonetThemeNotifier> load() async {
    final prefs = await SharedPreferences.getInstance();
    final isDark = prefs.getBool(_key) ?? true;
    return MonetThemeNotifier(isDark: isDark);
  }
}
