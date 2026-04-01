import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:record/record.dart';

import '../services/agent_client.dart';
import 'monet_theme.dart';

enum VoiceState { idle, recording, transcribing }

/// A press-and-hold microphone button that records audio and transcribes it.
///
/// Usage: place in any input area. On long-press, starts recording.
/// On release, sends audio to the backend for Whisper transcription.
/// Calls [onTranscribed] with the transcribed text.
class VoiceButton extends StatefulWidget {
  final void Function(String text) onTranscribed;

  /// Whether to render a larger button (for home screen).
  final bool large;

  const VoiceButton({
    super.key,
    required this.onTranscribed,
    this.large = false,
  });

  @override
  State<VoiceButton> createState() => VoiceButtonState();
}

@visibleForTesting
class VoiceButtonState extends State<VoiceButton>
    with SingleTickerProviderStateMixin {
  VoiceState _state = VoiceState.idle;
  final AudioRecorder _recorder = AudioRecorder();
  String? _recordingPath;
  late AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    );
  }

  @override
  void dispose() {
    _pulseController.dispose();
    _recorder.dispose();
    _cleanupRecording();
    super.dispose();
  }

  void _cleanupRecording() {
    if (_recordingPath != null) {
      try {
        File(_recordingPath!).deleteSync();
      } catch (_) {}
      _recordingPath = null;
    }
  }

  Future<void> _startRecording() async {
    try {
      if (!await _recorder.hasPermission()) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Microphone permission denied')),
          );
        }
        return;
      }

      final dir = await getTemporaryDirectory();
      final path =
          '${dir.path}/monet_voice_${DateTime.now().millisecondsSinceEpoch}.wav';

      await _recorder.start(
        const RecordConfig(
          encoder: AudioEncoder.wav,
          sampleRate: 16000,
          numChannels: 1,
        ),
        path: path,
      );

      _recordingPath = path;
      if (mounted) {
        setState(() => _state = VoiceState.recording);
        _pulseController.repeat(reverse: true);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to start recording: $e')),
        );
      }
    }
  }

  Future<void> _stopAndTranscribe() async {
    if (_state != VoiceState.recording) return;

    try {
      final path = await _recorder.stop();
      _pulseController.stop();
      _pulseController.reset();

      if (path == null || !mounted) {
        setState(() => _state = VoiceState.idle);
        return;
      }

      setState(() => _state = VoiceState.transcribing);

      final file = File(path);
      final bytes = await file.readAsBytes();

      // Clean up the temp file
      try {
        await file.delete();
      } catch (_) {}
      _recordingPath = null;

      if (bytes.isEmpty) {
        if (mounted) setState(() => _state = VoiceState.idle);
        return;
      }

      if (!mounted) return;
      final client = context.read<AgentClient>();
      final text = await client.transcribeAudio(bytes.toList(), 'recording.wav');

      if (mounted) {
        setState(() => _state = VoiceState.idle);
        if (text.isNotEmpty) {
          widget.onTranscribed(text);
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() => _state = VoiceState.idle);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Voice transcription failed: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = MonetColors.of(context);
    final size = widget.large ? 64.0 : 40.0;
    final iconSize = widget.large ? 32.0 : 22.0;

    Widget icon;
    Color iconColor;

    switch (_state) {
      case VoiceState.idle:
        icon = Icon(Icons.mic, size: iconSize);
        iconColor = c.textTertiary;
      case VoiceState.recording:
        icon = AnimatedBuilder(
          animation: _pulseController,
          builder: (context, child) {
            return Opacity(
              opacity: 0.5 + 0.5 * _pulseController.value,
              child: child,
            );
          },
          child: Icon(Icons.mic, size: iconSize),
        );
        iconColor = c.error;
      case VoiceState.transcribing:
        icon = SizedBox(
          width: iconSize * 0.7,
          height: iconSize * 0.7,
          child: CircularProgressIndicator(
            strokeWidth: 2,
            color: c.primary,
          ),
        );
        iconColor = c.primary;
    }

    if (widget.large) {
      return GestureDetector(
        onLongPressStart: (_) => _startRecording(),
        onLongPressEnd: (_) => _stopAndTranscribe(),
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: _state == VoiceState.recording
                ? c.error.withAlpha(30)
                : c.surface,
            border: Border.all(
              color: _state == VoiceState.recording ? c.error : c.border,
              width: _state == VoiceState.recording ? 2 : 1,
            ),
          ),
          child: Center(
            child: IconTheme(
              data: IconThemeData(color: iconColor),
              child: icon,
            ),
          ),
        ),
      );
    }

    return GestureDetector(
      onLongPressStart: (_) => _startRecording(),
      onLongPressEnd: (_) => _stopAndTranscribe(),
      child: SizedBox(
        width: size,
        height: size,
        child: Center(
          child: IconTheme(
            data: IconThemeData(color: iconColor),
            child: icon,
          ),
        ),
      ),
    );
  }
}
