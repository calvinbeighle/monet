import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../monet_theme.dart';

enum DiffType { unchanged, added, removed, modified }

class DiffLine {
  final String? left;
  final String? right;
  final DiffType type;

  const DiffLine({
    this.left,
    this.right,
    this.type = DiffType.unchanged,
  });
}

/// Lightweight syntax highlighter for code diffs.
/// Handles keywords, strings, comments, numbers, and annotations
/// across common languages (Python, JS/TS, Dart, Go, Rust, Java, C).
class SyntaxHighlighter {
  static const _keywords = {
    'if', 'else', 'elif', 'for', 'while', 'do', 'switch', 'case', 'break',
    'continue', 'return', 'yield', 'throw', 'try', 'catch', 'finally',
    'except', 'raise', 'with', 'match',
    'class', 'function', 'def', 'fn', 'func', 'var', 'let', 'const', 'final',
    'static', 'async', 'await', 'import', 'from', 'export', 'package',
    'struct', 'enum', 'interface', 'type', 'typedef', 'impl', 'trait', 'pub',
    'abstract', 'extends', 'implements', 'override', 'super', 'this', 'self',
    'new', 'delete', 'void', 'int', 'float', 'double', 'bool', 'String',
    'string', 'List', 'Map', 'Set', 'dict', 'list', 'tuple',
    'true', 'false', 'null', 'None', 'nil', 'undefined', 'True', 'False',
    'private', 'protected', 'public', 'readonly', 'required', 'late',
    'in', 'is', 'as', 'not', 'and', 'or', 'lambda',
  };

  static final _tokenPattern = RegExp(
    r'"(?:[^"\\]|\\.)*"'     // double-quoted strings
    r"|'(?:[^'\\]|\\.)*'"    // single-quoted strings
    r'|//.*|#.*'             // line comments
    r'|\b\d+\.?\d*(?:[eE][+-]?\d+)?\b' // numbers
    r'|@\w+'                 // annotations/decorators
    r'|\b[a-zA-Z_]\w*\b'    // identifiers
  );

  /// Tokenize a line of code into styled spans.
  static List<TextSpan> highlight(String code, Color baseColor) {
    if (code.isEmpty) return [TextSpan(text: code, style: TextStyle(color: baseColor))];

    final spans = <TextSpan>[];
    final pattern = _tokenPattern;

    int lastEnd = 0;
    for (final match in pattern.allMatches(code)) {
      if (match.start > lastEnd) {
        spans.add(TextSpan(
          text: code.substring(lastEnd, match.start),
          style: TextStyle(color: baseColor),
        ));
      }

      final text = match.group(0)!;
      final firstChar = text[0];
      Color color;

      if (firstChar == '"' || firstChar == "'") {
        color = const Color(0xFFCE9178); // warm orange - strings
      } else if (firstChar == '/' || firstChar == '#') {
        color = const Color(0xFF6A9955); // muted green - comments
      } else if (firstChar == '@') {
        color = const Color(0xFFDCDCAA); // yellow - decorators
      } else if (firstChar.codeUnitAt(0) >= 48 && firstChar.codeUnitAt(0) <= 57) {
        color = const Color(0xFFB5CEA8); // light green - numbers
      } else if (_keywords.contains(text)) {
        color = const Color(0xFF569CD6); // blue - keywords
      } else {
        color = baseColor;
      }

      spans.add(TextSpan(text: text, style: TextStyle(color: color)));
      lastEnd = match.end;
    }

    // Remaining text after last match
    if (lastEnd < code.length) {
      spans.add(TextSpan(
        text: code.substring(lastEnd),
        style: TextStyle(color: baseColor),
      ));
    }

    return spans;
  }
}

class DiffPattern extends StatefulWidget {
  final List<DiffLine> lines;
  final String leftTitle;
  final String rightTitle;
  final void Function(bool approved)? onDecision;

  const DiffPattern({
    super.key,
    required this.lines,
    this.leftTitle = 'Original',
    this.rightTitle = 'Modified',
    this.onDecision,
  });

  @override
  State<DiffPattern> createState() => _DiffPatternState();
}

class _DiffPatternState extends State<DiffPattern> {
  final ScrollController _scrollController = ScrollController();

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  Color _leftBackground(DiffType type, MonetColors c) {
    switch (type) {
      case DiffType.removed:
        return c.error.withValues(alpha: 0.1);
      case DiffType.modified:
        return c.error.withValues(alpha: 0.1);
      default:
        return Colors.transparent;
    }
  }

  Color _rightBackground(DiffType type, MonetColors c) {
    switch (type) {
      case DiffType.added:
        return c.success.withValues(alpha: 0.1);
      case DiffType.modified:
        return c.success.withValues(alpha: 0.1);
      default:
        return Colors.transparent;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _buildHeader()
            .animate()
            .fadeIn(duration: 300.ms, curve: Curves.easeOut)
            .slideY(begin: -0.3, end: 0, duration: 300.ms, curve: Curves.easeOut),
        Expanded(
          child: _buildDiffView()
              .animate(delay: 150.ms)
              .fadeIn(duration: 400.ms, curve: Curves.easeOut),
        ),
        if (widget.onDecision != null)
          _buildActions()
              .animate(delay: 300.ms)
              .fadeIn(duration: 300.ms, curve: Curves.easeOut)
              .slideY(begin: 0.3, end: 0, duration: 300.ms, curve: Curves.easeOut),
      ],
    );
  }

  Widget _buildHeader() {
    final c = MonetColors.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: c.surface,
        border: Border(
          bottom: BorderSide(color: c.border),
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              widget.leftTitle,
              style: TextStyle(
                color: c.textSecondary,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          Container(
            width: 1,
            height: 20,
            color: c.border,
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(left: 16),
              child: Text(
                widget.rightTitle,
                style: TextStyle(
                  color: c.textSecondary,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDiffView() {
    final c = MonetColors.of(context);
    return ListView.builder(
      controller: _scrollController,
      itemCount: widget.lines.length,
      itemBuilder: (context, index) {
        final line = widget.lines[index];
        return IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: Container(
                  color: _leftBackground(line.type, c),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
                  child: RichText(
                    text: TextSpan(
                      style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
                      children: SyntaxHighlighter.highlight(
                        line.left ?? '',
                        line.type == DiffType.removed || line.type == DiffType.modified
                            ? c.error
                            : c.textSecondary,
                      ),
                    ),
                  ),
                ),
              ),
              Container(
                width: 1,
                color: c.borderSubtle,
              ),
              Expanded(
                child: Container(
                  color: _rightBackground(line.type, c),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
                  child: RichText(
                    text: TextSpan(
                      style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
                      children: SyntaxHighlighter.highlight(
                        line.right ?? '',
                        line.type == DiffType.added || line.type == DiffType.modified
                            ? c.success
                            : c.textSecondary,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildActions() {
    final c = MonetColors.of(context);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: c.scaffoldBg,
        border: Border(
          top: BorderSide(color: c.border),
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          OutlinedButton.icon(
            onPressed: () => widget.onDecision?.call(false),
            icon: const Icon(Icons.close, size: 18),
            label: const Text('Reject All'),
            style: OutlinedButton.styleFrom(
              foregroundColor: c.error,
              side: BorderSide(color: c.error.withValues(alpha: 0.5)),
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
            ),
          ),
          const SizedBox(width: 16),
          FilledButton.icon(
            onPressed: () => widget.onDecision?.call(true),
            icon: const Icon(Icons.check, size: 18),
            label: const Text('Approve All'),
            style: FilledButton.styleFrom(
              backgroundColor: c.success,
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
            ),
          ),
        ],
      ),
    );
  }
}
