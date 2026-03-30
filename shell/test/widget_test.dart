import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:shell/main.dart';
import 'package:shell/services/agent_client.dart';
import 'package:shell/ui/approval_overlay.dart';
import 'package:shell/ui/patterns/tinder.dart';
import 'package:shell/ui/patterns/chat.dart';
import 'package:shell/ui/patterns/diff.dart';
import 'package:shell/ui/patterns/whiteboard.dart';
import 'package:shell/ui/status_bar.dart';

// -- MonetApp tests --

void main() {
  group('MonetApp', () {
    testWidgets('renders with chat input when chat pattern is default', (tester) async {
      await tester.pumpWidget(const MonetApp());
      // Chat is the default pattern, so the chat input bar is shown
      // instead of the shell intent bar (which only shows for non-chat patterns)
      expect(find.text('Type a message...'), findsOneWidget);
    });

    testWidgets('renders status bar with tool indicators', (tester) async {
      await tester.pumpWidget(const MonetApp());
      expect(find.text('Gmail'), findsOneWidget);
      expect(find.text('GitHub'), findsOneWidget);
    });

    testWidgets('starts with chat pattern as default', (tester) async {
      await tester.pumpWidget(const MonetApp());
      // Chat pattern shows the input field
      expect(find.text('Type a message...'), findsOneWidget);
    });
  });

  // -- AgentClient model tests --

  group('AgentClient models', () {
    test('AgentEvent.fromJson parses correctly', () {
      final event = AgentEvent.fromJson({
        'type': 'token',
        'data': 'hello',
        'metadata': {'key': 'value'},
      });
      expect(event.type, 'token');
      expect(event.data, 'hello');
      expect(event.metadata['key'], 'value');
    });

    test('AgentEvent.fromJson handles missing fields', () {
      final event = AgentEvent.fromJson({});
      expect(event.type, '');
      expect(event.data, '');
      expect(event.metadata, isEmpty);
    });

    test('AgentResult.fromJson parses outputs', () {
      final result = AgentResult.fromJson({
        'agent': 'email',
        'ui_pattern': 'tinder',
        'outputs': [
          {'content': 'test', 'status': 'complete'},
        ],
      });
      expect(result.agent, 'email');
      expect(result.uiPattern, 'tinder');
      expect(result.outputs.length, 1);
      expect(result.outputs[0].content, 'test');
    });

    test('AgentResult.fromJson handles empty outputs', () {
      final result = AgentResult.fromJson({
        'agent': 'code',
        'ui_pattern': 'diff',
      });
      expect(result.outputs, isEmpty);
    });

    test('ApprovalRequest.fromJson parses correctly', () {
      final req = ApprovalRequest.fromJson({
        'id': 'abc12345',
        'tool_name': 'send_email',
        'parameters': {'to': 'test@example.com'},
        'status': 'pending',
        'session_id': 'sess-1',
      });
      expect(req.id, 'abc12345');
      expect(req.toolName, 'send_email');
      expect(req.status, 'pending');
      expect(req.sessionId, 'sess-1');
    });

    test('AgentOutput.fromJson defaults', () {
      final output = AgentOutput.fromJson({});
      expect(output.content, '');
      expect(output.status, 'complete');
      expect(output.metadata, isEmpty);
    });
  });

  // -- TinderPattern tests --

  group('TinderPattern', () {
    testWidgets('renders cards with counter', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: TinderPattern(
            cards: [
              TinderCard(title: 'Email 1', body: 'Body 1'),
              TinderCard(title: 'Email 2', body: 'Body 2'),
            ],
          ),
        ),
      ));
      expect(find.text('1 of 2'), findsOneWidget);
      expect(find.text('Email 1'), findsOneWidget);
    });

    testWidgets('shows summary when all cards processed', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: TinderPattern(cards: const []),
        ),
      ));
      expect(find.text('All done'), findsOneWidget);
    });

    testWidgets('undo button disabled on first card', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: TinderPattern(
            cards: [TinderCard(title: 'Test', body: 'Body')],
          ),
        ),
      ));
      final undoButton = find.byIcon(Icons.undo);
      expect(undoButton, findsOneWidget);
    });

    testWidgets('calls onDecision when swiped right', (tester) async {
      int? decidedIndex;
      bool? decidedApproved;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: TinderPattern(
            cards: [
              TinderCard(title: 'Card 1', body: 'Body'),
              TinderCard(title: 'Card 2', body: 'Body'),
            ],
            onDecision: (index, approved) {
              decidedIndex = index;
              decidedApproved = approved;
            },
          ),
        ),
      ));

      // Swipe right past threshold (100px)
      final card = find.text('Card 1');
      await tester.drag(card, const Offset(150, 0));
      await tester.pumpAndSettle();

      expect(decidedIndex, 0);
      expect(decidedApproved, true);
    });

    testWidgets('calls onDecision when swiped left', (tester) async {
      int? decidedIndex;
      bool? decidedApproved;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: TinderPattern(
            cards: [
              TinderCard(title: 'Card 1', body: 'Body'),
              TinderCard(title: 'Card 2', body: 'Body'),
            ],
            onDecision: (index, approved) {
              decidedIndex = index;
              decidedApproved = approved;
            },
          ),
        ),
      ));

      final card = find.text('Card 1');
      await tester.drag(card, const Offset(-150, 0));
      await tester.pumpAndSettle();

      expect(decidedIndex, 0);
      expect(decidedApproved, false);
    });
  });

  // -- ChatPattern tests --

  group('ChatPattern', () {
    testWidgets('renders messages', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: ChatPattern(
            messages: [
              ChatMessage(content: 'Hello', isUser: true),
              ChatMessage(content: 'Hi there', isUser: false),
            ],
          ),
        ),
      ));
      expect(find.text('Hello'), findsOneWidget);
      expect(find.text('Hi there'), findsOneWidget);
    });

    testWidgets('renders input field', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: ChatPattern(messages: const []),
        ),
      ));
      expect(find.text('Type a message...'), findsOneWidget);
    });

    testWidgets('renders suggestions', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: ChatPattern(
            messages: const [],
            suggestions: const ['Reply', 'Forward'],
          ),
        ),
      ));
      expect(find.text('Reply'), findsOneWidget);
      expect(find.text('Forward'), findsOneWidget);
    });

    testWidgets('shows typing indicator when streaming', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: ChatPattern(
            messages: const [],
            isStreaming: true,
          ),
        ),
      ));
      // Pump past the Future.delayed timers (0, 200, 400ms) to start animations
      await tester.pump(const Duration(milliseconds: 500));
      expect(find.byType(ChatPattern), findsOneWidget);
      // Dispose the widget tree which stops the repeating animations
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('calls onSend when text submitted', (tester) async {
      String? sentMessage;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: ChatPattern(
            messages: const [],
            onSend: (msg) => sentMessage = msg,
          ),
        ),
      ));
      await tester.enterText(find.byType(TextField), 'test message');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump();
      expect(sentMessage, 'test message');
    });

    testWidgets('renders system messages with tool icon', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: ChatPattern(
            messages: [
              ChatMessage(
                content: 'Using tool: list inbox',
                isUser: false,
                isSystem: true,
              ),
            ],
          ),
        ),
      ));
      expect(find.text('Using tool: list inbox'), findsOneWidget);
      expect(find.byIcon(Icons.build_outlined), findsOneWidget);
    });

    testWidgets('system messages are centered', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: ChatPattern(
            messages: [
              ChatMessage(
                content: 'System action',
                isUser: false,
                isSystem: true,
              ),
            ],
          ),
        ),
      ));
      // System messages use Center widget
      expect(find.ancestor(
        of: find.text('System action'),
        matching: find.byType(Center),
      ), findsWidgets);
    });

    testWidgets('renders inline approval card with buttons', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: ChatPattern(
            messages: [
              ChatMessage(
                content: 'Approve send_email?',
                isUser: false,
                isApproval: true,
                approvalId: 'test-123',
                toolName: 'send_email',
                approvalParameters: {'to': 'john@example.com'},
              ),
            ],
            onApprovalDecision: (_, __) {},
          ),
        ),
      ));
      expect(find.text('send email'), findsOneWidget);
      expect(find.text('Approve'), findsOneWidget);
      expect(find.text('Reject'), findsOneWidget);
      expect(find.byIcon(Icons.shield_outlined), findsOneWidget);
    });

    testWidgets('inline approval card calls onApprovalDecision', (tester) async {
      String? decidedId;
      bool? decidedApproved;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: ChatPattern(
            messages: [
              ChatMessage(
                content: 'Approve merge_pr?',
                isUser: false,
                isApproval: true,
                approvalId: 'test-456',
                toolName: 'merge_pr',
              ),
            ],
            onApprovalDecision: (id, approved) {
              decidedId = id;
              decidedApproved = approved;
            },
          ),
        ),
      ));
      await tester.tap(find.text('Approve'));
      expect(decidedId, 'test-456');
      expect(decidedApproved, true);
    });

    testWidgets('resolved approval card shows status', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: ChatPattern(
            messages: [
              ChatMessage(
                content: 'Approve send_email?',
                isUser: false,
                isApproval: true,
                approvalId: 'test-789',
                toolName: 'send_email',
                approvalStatus: 'approved',
              ),
            ],
          ),
        ),
      ));
      expect(find.text('Approved'), findsOneWidget);
      expect(find.text('Approve'), findsNothing);
      expect(find.text('Reject'), findsNothing);
    });

    testWidgets('rejected approval card shows status', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: ChatPattern(
            messages: [
              ChatMessage(
                content: 'Approve send_email?',
                isUser: false,
                isApproval: true,
                approvalId: 'test-101',
                toolName: 'send_email',
                approvalStatus: 'rejected',
              ),
            ],
          ),
        ),
      ));
      expect(find.text('Rejected'), findsOneWidget);
      expect(find.byIcon(Icons.cancel), findsOneWidget);
    });
  });

  // -- DiffPattern tests --

  group('DiffPattern', () {
    testWidgets('renders header with titles', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: DiffPattern(
            lines: const [],
            leftTitle: 'Before',
            rightTitle: 'After',
          ),
        ),
      ));
      expect(find.text('Before'), findsOneWidget);
      expect(find.text('After'), findsOneWidget);
    });

    testWidgets('renders diff lines', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: DiffPattern(
            lines: const [
              DiffLine(left: 'old line', right: 'new line', type: DiffType.modified),
              DiffLine(left: 'same', right: 'same', type: DiffType.unchanged),
            ],
          ),
        ),
      ));
      expect(find.text('old line'), findsOneWidget);
      expect(find.text('new line'), findsOneWidget);
    });

    testWidgets('renders action buttons when onDecision provided', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: DiffPattern(
            lines: const [],
            onDecision: (_) {},
          ),
        ),
      ));
      expect(find.text('Approve All'), findsOneWidget);
      expect(find.text('Reject All'), findsOneWidget);
    });

    testWidgets('calls onDecision with true for approve', (tester) async {
      bool? decision;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: DiffPattern(
            lines: const [],
            onDecision: (d) => decision = d,
          ),
        ),
      ));
      await tester.tap(find.text('Approve All'));
      expect(decision, true);
    });

    testWidgets('calls onDecision with false for reject', (tester) async {
      bool? decision;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: DiffPattern(
            lines: const [],
            onDecision: (d) => decision = d,
          ),
        ),
      ));
      await tester.tap(find.text('Reject All'));
      expect(decision, false);
    });

    testWidgets('hides action buttons when no onDecision', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: DiffPattern(lines: const []),
        ),
      ));
      expect(find.text('Approve All'), findsNothing);
    });
  });

  // -- WhiteboardPattern tests --

  group('WhiteboardPattern', () {
    testWidgets('renders nodes', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: WhiteboardPattern(
            nodes: [
              WhiteboardNode(id: '1', title: 'Task A', x: 100, y: 100),
              WhiteboardNode(id: '2', title: 'Task B', x: 400, y: 200),
            ],
          ),
        ),
      ));
      expect(find.text('Task A'), findsOneWidget);
      expect(find.text('Task B'), findsOneWidget);
    });

    testWidgets('renders node body text', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: WhiteboardPattern(
            nodes: [
              WhiteboardNode(
                id: '1',
                title: 'Node',
                body: 'Description text',
                x: 100,
                y: 100,
              ),
            ],
          ),
        ),
      ));
      expect(find.text('Description text'), findsOneWidget);
    });

    testWidgets('calls onNodeTap when node tapped', (tester) async {
      String? tappedId;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: WhiteboardPattern(
            nodes: [
              WhiteboardNode(id: 'n1', title: 'Tap Me', x: 100, y: 100),
            ],
            onNodeTap: (id) => tappedId = id,
          ),
        ),
      ));
      await tester.tap(find.text('Tap Me'));
      expect(tappedId, 'n1');
    });

    testWidgets('renders with InteractiveViewer', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: WhiteboardPattern(nodes: const []),
        ),
      ));
      expect(find.byType(InteractiveViewer), findsOneWidget);
    });
  });

  // -- StatusBar tests --

  group('StatusBar', () {
    testWidgets('renders tool indicators', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: StatusBar(
            tools: const [
              ConnectedTool(name: 'Gmail', connected: true),
              ConnectedTool(name: 'GitHub', connected: false),
            ],
          ),
        ),
      ));
      expect(find.text('Gmail'), findsOneWidget);
      expect(find.text('GitHub'), findsOneWidget);
    });

    testWidgets('shows active agent when running', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: StatusBar(activeAgent: 'email'),
        ),
      ));
      expect(find.text('email'), findsOneWidget);
    });

    testWidgets('shows pattern badge', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: StatusBar(activePattern: 'tinder'),
        ),
      ));
      expect(find.text('tinder'), findsOneWidget);
    });

    testWidgets('hides agent indicator when null', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: StatusBar(),
        ),
      ));
      expect(find.byType(CircularProgressIndicator), findsNothing);
    });
  });

  // -- ApprovalOverlay tests --

  group('ApprovalOverlay', () {
    testWidgets('renders tool name and parameters', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () {
                showDialog(
                  context: context,
                  builder: (_) => ApprovalOverlay(
                    toolName: 'send_email',
                    parameters: {'to': 'john@example.com', 'subject': 'Hello'},
                    approvalId: 'test-123',
                    client: AgentClient(),
                    onResolved: () {},
                  ),
                );
              },
              child: const Text('Show'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Show'));
      await tester.pumpAndSettle();

      expect(find.text('Approval Required'), findsOneWidget);
      expect(find.text('send email'), findsOneWidget);
      expect(find.text('Approve'), findsOneWidget);
      expect(find.text('Reject'), findsOneWidget);
      expect(find.textContaining('john@example.com'), findsOneWidget);
    });

    testWidgets('renders shield icon', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () {
                showDialog(
                  context: context,
                  builder: (_) => ApprovalOverlay(
                    toolName: 'merge_pr',
                    parameters: {},
                    approvalId: 'test-456',
                    client: AgentClient(),
                    onResolved: () {},
                  ),
                );
              },
              child: const Text('Show'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Show'));
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.shield_outlined), findsOneWidget);
    });

    testWidgets('shows formatted parameters', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () {
                showDialog(
                  context: context,
                  builder: (_) => ApprovalOverlay(
                    toolName: 'archive_email',
                    parameters: {},
                    approvalId: 'test-789',
                    client: AgentClient(),
                    onResolved: () {},
                  ),
                );
              },
              child: const Text('Show'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Show'));
      await tester.pumpAndSettle();

      expect(find.text('No parameters'), findsOneWidget);
    });
  });
}
