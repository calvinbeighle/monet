/// Onboarding and login screens for Monet OS.
///
/// First boot: detects no user exists and shows account creation,
/// then Connect Tools step for Gmail/GitHub OAuth.
/// Subsequent boots: shows lock screen with username/password login.
/// Session persists until explicit logout or app restart.

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/agent_client.dart';

/// The states the onboarding flow can be in.
enum _OnboardingState { loading, createAccount, connectTools, login }

class OnboardingScreen extends StatefulWidget {
  final VoidCallback onAuthenticated;

  const OnboardingScreen({super.key, required this.onAuthenticated});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  _OnboardingState _state = _OnboardingState.loading;
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  String? _errorMessage;
  bool _isSubmitting = false;
  bool _obscurePassword = true;
  bool _obscureConfirm = true;

  // Tool connection state for the Connect Tools step
  List<_ToolInfo> _tools = [];
  bool _loadingTools = false;
  bool _nangoConfigured = false;

  @override
  void initState() {
    super.initState();
    _checkAuthStatus();
  }

  @override
  void dispose() {
    _usernameController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  Future<void> _checkAuthStatus() async {
    final client = context.read<AgentClient>();
    try {
      final status = await client.authStatus();
      final hasUsers = status['has_users'] as bool? ?? false;
      setState(() {
        _state = hasUsers ? _OnboardingState.login : _OnboardingState.createAccount;
      });
    } catch (e) {
      // Backend not reachable - show login screen with error
      setState(() {
        _state = _OnboardingState.login;
        _errorMessage = 'Cannot connect to backend. Is the agent server running?';
      });
    }
  }

  Future<void> _handleCreateAccount() async {
    final username = _usernameController.text.trim();
    final password = _passwordController.text;
    final confirm = _confirmPasswordController.text;

    if (username.isEmpty) {
      setState(() => _errorMessage = 'Username is required');
      return;
    }
    if (password.length < 4) {
      setState(() => _errorMessage = 'Password must be at least 4 characters');
      return;
    }
    if (password != confirm) {
      setState(() => _errorMessage = 'Passwords do not match');
      return;
    }

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    final client = context.read<AgentClient>();
    try {
      await client.createUser(username, password);
      // After account creation, show Connect Tools step
      setState(() {
        _isSubmitting = false;
        _state = _OnboardingState.connectTools;
      });
      _loadToolStatus();
    } catch (e) {
      setState(() {
        _isSubmitting = false;
        _errorMessage = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _handleLogin() async {
    final username = _usernameController.text.trim();
    final password = _passwordController.text;

    if (username.isEmpty || password.isEmpty) {
      setState(() => _errorMessage = 'Username and password are required');
      return;
    }

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    final client = context.read<AgentClient>();
    try {
      await client.login(username, password);
      widget.onAuthenticated();
    } catch (e) {
      setState(() {
        _isSubmitting = false;
        _errorMessage = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _loadToolStatus() async {
    setState(() => _loadingTools = true);
    final client = context.read<AgentClient>();
    try {
      final data = await client.toolsStatus();
      final tools = data['tools'] as List<dynamic>? ?? [];
      final configured = data['configured'] as bool? ?? false;
      if (mounted) {
        setState(() {
          _nangoConfigured = configured;
          _tools = tools
              .map((t) => _ToolInfo(
                    name: (t as Map<String, dynamic>)['name'] as String? ?? '',
                    provider: t['provider'] as String? ?? '',
                    connected: t['connected'] as bool? ?? false,
                  ))
              .toList();
          _loadingTools = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _loadingTools = false;
          _tools = [
            _ToolInfo(name: 'Gmail', provider: 'gmail', connected: false),
            _ToolInfo(name: 'GitHub', provider: 'github', connected: false),
            _ToolInfo(name: 'Google Docs', provider: 'google-docs', connected: false),
          ];
        });
      }
    }
  }

  Future<void> _handleConnect(String provider) async {
    final client = context.read<AgentClient>();
    try {
      final data = await client.toolConnectUrl(provider);
      final url = data['url'] as String?;
      if (url != null && mounted) {
        // Show the OAuth URL in a dialog - on the real OS this would
        // open in a webview. For now, show the URL and a refresh button.
        await showDialog(
          context: context,
          builder: (ctx) => AlertDialog(
            backgroundColor: const Color(0xFF12121A),
            title: Text(
              'Connect ${provider == 'gmail' ? 'Gmail' : provider == 'google-docs' ? 'Google Docs' : 'GitHub'}',
              style: TextStyle(color: Colors.white.withValues(alpha: 0.8)),
            ),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Complete the OAuth flow in your browser, then tap Refresh to verify the connection.',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.6),
                    fontSize: 13,
                  ),
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: const Color(0xFF0A0A0F),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: SelectableText(
                    url,
                    style: TextStyle(
                      color: const Color(0xFF7C6EF0),
                      fontSize: 11,
                    ),
                  ),
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: Text(
                  'Close',
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.5)),
                ),
              ),
            ],
          ),
        );
        // Refresh tool status after dialog closes
        _loadToolStatus();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = e.toString().replaceFirst('Exception: ', '');
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A0A0F),
      body: Center(
        child: _buildContent(),
      ),
    );
  }

  Widget _buildContent() {
    switch (_state) {
      case _OnboardingState.loading:
        return const CircularProgressIndicator(
          color: Color(0xFF7C6EF0),
        );
      case _OnboardingState.createAccount:
        return _buildCreateAccountForm();
      case _OnboardingState.connectTools:
        return _buildConnectToolsForm();
      case _OnboardingState.login:
        return _buildLoginForm();
    }
  }

  Widget _buildCreateAccountForm() {
    return _FormCard(
      title: 'Welcome to Monet',
      subtitle: 'Create your account to get started.',
      error: _errorMessage,
      isSubmitting: _isSubmitting,
      children: [
        _buildTextField(
          controller: _usernameController,
          hint: 'Username',
          icon: Icons.person_outline,
          onSubmitted: (_) => _handleCreateAccount(),
        ),
        const SizedBox(height: 12),
        _buildTextField(
          controller: _passwordController,
          hint: 'Password',
          icon: Icons.lock_outline,
          obscure: _obscurePassword,
          onToggleObscure: () => setState(() => _obscurePassword = !_obscurePassword),
          onSubmitted: (_) => _handleCreateAccount(),
        ),
        const SizedBox(height: 12),
        _buildTextField(
          controller: _confirmPasswordController,
          hint: 'Confirm password',
          icon: Icons.lock_outline,
          obscure: _obscureConfirm,
          onToggleObscure: () => setState(() => _obscureConfirm = !_obscureConfirm),
          onSubmitted: (_) => _handleCreateAccount(),
        ),
        const SizedBox(height: 24),
        _buildSubmitButton('Create Account', _handleCreateAccount),
      ],
    );
  }

  Widget _buildConnectToolsForm() {
    return _FormCard(
      title: 'Connect Your Tools',
      subtitle: 'Link your accounts so Monet can work with your email, code, and documents.',
      error: _errorMessage,
      children: [
        if (_loadingTools)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Center(
              child: CircularProgressIndicator(color: Color(0xFF7C6EF0)),
            ),
          )
        else
          ..._tools.map((tool) => _buildToolRow(tool)),
        if (!_nangoConfigured && !_loadingTools) ...[
          const SizedBox(height: 8),
          Text(
            'Set NANGO_SECRET_KEY to enable OAuth connections.',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.3),
              fontSize: 12,
            ),
          ),
        ],
        const SizedBox(height: 24),
        Row(
          children: [
            Expanded(
              child: TextButton(
                onPressed: () {
                  _loadToolStatus();
                },
                child: Text(
                  'Refresh',
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.5)),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              flex: 2,
              child: _buildSubmitButton('Continue', () {
                widget.onAuthenticated();
              }),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildToolRow(_ToolInfo tool) {
    final IconData icon;
    if (tool.provider == 'gmail') {
      icon = Icons.email_outlined;
    } else if (tool.provider == 'google-docs') {
      icon = Icons.description_outlined;
    } else {
      icon = Icons.code;
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: const Color(0xFF0A0A0F),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: tool.connected
                ? Colors.green.withValues(alpha: 0.3)
                : Colors.white.withValues(alpha: 0.08),
          ),
        ),
        child: Row(
          children: [
            Icon(
              icon,
              size: 20,
              color: tool.connected
                  ? Colors.green
                  : Colors.white.withValues(alpha: 0.4),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    tool.name,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  Text(
                    tool.connected ? 'Connected' : 'Not connected',
                    style: TextStyle(
                      color: tool.connected
                          ? Colors.green.withValues(alpha: 0.8)
                          : Colors.white.withValues(alpha: 0.3),
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
            if (tool.connected)
              Icon(Icons.check_circle, size: 20, color: Colors.green)
            else
              SizedBox(
                height: 32,
                child: TextButton(
                  onPressed: _nangoConfigured ? () => _handleConnect(tool.provider) : null,
                  style: TextButton.styleFrom(
                    foregroundColor: const Color(0xFF7C6EF0),
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                  ),
                  child: const Text('Connect', style: TextStyle(fontSize: 13)),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildLoginForm() {
    return _FormCard(
      title: 'Monet',
      subtitle: 'Sign in to continue.',
      error: _errorMessage,
      isSubmitting: _isSubmitting,
      children: [
        _buildTextField(
          controller: _usernameController,
          hint: 'Username',
          icon: Icons.person_outline,
          onSubmitted: (_) => _handleLogin(),
        ),
        const SizedBox(height: 12),
        _buildTextField(
          controller: _passwordController,
          hint: 'Password',
          icon: Icons.lock_outline,
          obscure: _obscurePassword,
          onToggleObscure: () => setState(() => _obscurePassword = !_obscurePassword),
          onSubmitted: (_) => _handleLogin(),
        ),
        const SizedBox(height: 24),
        _buildSubmitButton('Sign In', _handleLogin),
      ],
    );
  }

  Widget _buildTextField({
    required TextEditingController controller,
    required String hint,
    required IconData icon,
    bool obscure = false,
    VoidCallback? onToggleObscure,
    ValueChanged<String>? onSubmitted,
  }) {
    return TextField(
      controller: controller,
      obscureText: obscure,
      style: const TextStyle(color: Colors.white, fontSize: 15),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: TextStyle(color: Colors.white.withValues(alpha: 0.3)),
        prefixIcon: Icon(icon, color: Colors.white.withValues(alpha: 0.4), size: 20),
        suffixIcon: onToggleObscure != null
            ? IconButton(
                onPressed: onToggleObscure,
                icon: Icon(
                  obscure ? Icons.visibility_off : Icons.visibility,
                  color: Colors.white.withValues(alpha: 0.4),
                  size: 20,
                ),
              )
            : null,
        filled: true,
        fillColor: const Color(0xFF12121A),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide.none,
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      ),
      onSubmitted: _isSubmitting ? null : onSubmitted,
      enabled: !_isSubmitting,
    );
  }

  Widget _buildSubmitButton(String label, VoidCallback onPressed) {
    return SizedBox(
      width: double.infinity,
      height: 48,
      child: ElevatedButton(
        onPressed: _isSubmitting ? null : onPressed,
        style: ElevatedButton.styleFrom(
          backgroundColor: const Color(0xFF7C6EF0),
          foregroundColor: Colors.white,
          disabledBackgroundColor: const Color(0xFF7C6EF0).withValues(alpha: 0.5),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
        child: _isSubmitting
            ? const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: Colors.white,
                ),
              )
            : Text(label, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
      ),
    );
  }
}

/// Tool info for the Connect Tools step.
class _ToolInfo {
  final String name;
  final String provider;
  final bool connected;

  const _ToolInfo({
    required this.name,
    required this.provider,
    required this.connected,
  });
}

/// Shared form card wrapper with title, subtitle, and error display.
class _FormCard extends StatelessWidget {
  final String title;
  final String subtitle;
  final String? error;
  final bool isSubmitting;
  final List<Widget> children;

  const _FormCard({
    required this.title,
    required this.subtitle,
    required this.children,
    this.error,
    this.isSubmitting = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 360,
      padding: const EdgeInsets.all(32),
      decoration: BoxDecoration(
        color: const Color(0xFF12121A),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withValues(alpha: 0.06)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 24,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            subtitle,
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.5),
              fontSize: 14,
            ),
          ),
          const SizedBox(height: 24),
          if (error != null) ...[
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colors.red.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.red.withValues(alpha: 0.3)),
              ),
              child: Text(
                error!,
                style: TextStyle(color: Colors.red.shade300, fontSize: 13),
              ),
            ),
            const SizedBox(height: 16),
          ],
          ...children,
        ],
      ),
    );
  }
}
