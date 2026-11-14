import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../core/theme.dart';
import 'popup.dart';

enum NoticeKind { error, warning, success, info }

class _NoticeQueue {
  Future<void> tail = Future<void>.value();
  final pending = <String, Future<void>>{};
}

final _queues = Expando<_NoticeQueue>();

/// Queue notifications on the root navigator so errors appear above sheets.
/// Identical pending messages share one dialog; distinct messages stay ordered.
Future<void> showNotice(BuildContext context, String message, {
  NoticeKind kind = NoticeKind.info,
  String? title,
  String? details,
  String? actionLabel,
  Future<void> Function()? onAction,
}) {
  if (!context.mounted || message.trim().isEmpty) return Future<void>.value();
  final navigator = Navigator.of(context, rootNavigator: true);
  final queue = _queues[navigator] ??= _NoticeQueue();
  final key = '${kind.name}|$title|$message|$details|$actionLabel';
  final existing = queue.pending[key];
  if (existing != null) return existing;
  final task = queue.tail.then((_) async {
    if (!context.mounted || !navigator.mounted) return;
    FocusManager.instance.primaryFocus?.unfocus();
    final color = switch (kind) {
      NoticeKind.error => errorColor,
      NoticeKind.warning => warningColor,
      NoticeKind.success => successColor,
      NoticeKind.info => primaryInk,
    };
    final icon = switch (kind) {
      NoticeKind.error => Icons.error_outline,
      NoticeKind.warning => Icons.warning_amber_rounded,
      NoticeKind.success => Icons.check_circle_outline,
      NoticeKind.info => Icons.info_outline,
    };
    final heading = title ?? switch (kind) {
      NoticeKind.error => 'Terjadi kesalahan',
      NoticeKind.warning => 'Perlu perhatian',
      NoticeKind.success => 'Berhasil',
      NoticeKind.info => 'Informasi',
    };
    final act = await showGeneralDialog<bool>(
      context: context,
      useRootNavigator: true,
      barrierDismissible: false,
      barrierLabel: 'Notifikasi',
      barrierColor: Colors.black54,
      transitionDuration: Motion.duration(context, Motion.enter),
      transitionBuilder: (context, animation, secondary, child) {
        final curved = CurvedAnimation(parent: animation, curve: Curves.easeOutCubic, reverseCurve: Curves.easeInCubic);
        return FadeTransition(opacity: curved, child: SlideTransition(
          position: Tween<Offset>(begin: const Offset(0, .025), end: Offset.zero).animate(curved), child: child));
      },
      pageBuilder: (dialogContext, animation, secondary) {
        var handled = false;
        void dismiss(bool action) {
          if (handled) return;
          handled = true;
          Navigator.of(dialogContext).pop(action);
        }
        return PopScope(
          canPop: false,
          child: Focus(
            autofocus: true,
            onKeyEvent: (node, event) {
              if (event is! KeyDownEvent) return KeyEventResult.ignored;
              if (event.logicalKey == LogicalKeyboardKey.enter ||
                  event.logicalKey == LogicalKeyboardKey.numpadEnter) {
                dismiss(onAction != null);
                return KeyEventResult.handled;
              }
              if (event.logicalKey == LogicalKeyboardKey.escape) {
                dismiss(false);
                return KeyEventResult.handled;
              }
              return KeyEventResult.ignored;
            },
            child: AppPopup(
              icon: icon, tone: color, title: heading,
              body: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(message),
                if (details != null && details.trim().isNotEmpty) ExpansionTile(
                  tilePadding: EdgeInsets.zero, title: const Text('Detail masalah'),
                  children: [SelectableText(details, style: Theme.of(dialogContext).textTheme.bodySmall)],
                ),
              ]),
              actions: [
                if (onAction != null) PopupButton('Nanti', keyHint: 'Esc', onPressed: () => dismiss(false)),
                PopupButton(actionLabel ?? 'Mengerti', primary: true, autofocus: true, keyHint: 'Enter',
                  onPressed: () => dismiss(onAction != null)),
              ],
            ),
          ),
        );
      },
    );
    if (act == true && onAction != null) {
      // Run recovery after the notice leaves the queue. Recovery may show another notice.
      WidgetsBinding.instance.addPostFrameCallback((_) { if (context.mounted) onAction(); });
      WidgetsBinding.instance.scheduleFrame();
    }
  });
  final completed = task.whenComplete(() { queue.pending.remove(key); });
  queue.pending[key] = completed;
  queue.tail = completed;
  return completed;
}

/// Observe persistent notices without presenting them again on every rebuild.
/// Place outside lazy lists so a message is visible even below the fold.
class NoticeListener extends StatefulWidget {
  const NoticeListener({super.key, required this.message, required this.child,
    this.kind = NoticeKind.warning});
  final String? message;
  final NoticeKind kind;
  final Widget child;
  @override
  State<NoticeListener> createState() => _NoticeListenerState();
}

class _NoticeListenerState extends State<NoticeListener> {
  @override
  void initState() { super.initState(); _schedule(); }
  @override
  void didUpdateWidget(NoticeListener oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.message != widget.message || oldWidget.kind != widget.kind) _schedule();
  }
  void _schedule() {
    final message = widget.message;
    if (message == null || message.trim().isEmpty) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && widget.message == message) {
        showNotice(context, message, kind: widget.kind);
      }
    });
  }
  @override
  Widget build(BuildContext context) => widget.child;
}
