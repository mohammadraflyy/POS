import 'package:flutter/services.dart';

/// Tells a USB barcode scanner from a person typing, the way the desktop till did: a
/// scanner is a keyboard that types a code faster than anyone can (under [gap] between
/// keys) and ends it with Enter. Feed it every key press that no text field took.
class BarcodeBurst {
  BarcodeBurst({this.gap = const Duration(milliseconds: 100), this.minLength = 4, DateTime Function()? clock}) : _clock = clock ?? DateTime.now;

  final Duration gap;
  final int minLength;
  final DateTime Function() _clock;
  final StringBuffer _buffer = StringBuffer();
  DateTime? _lastKeyAt;

  /// Returns the scanned code when [event] is the Enter that ends a scan; null otherwise.
  /// [handled] tells the caller whether the key was part of a scan, so it can be swallowed.
  ({String? code, bool handled}) feed(KeyEvent event) {
    if (event is! KeyDownEvent) return (code: null, handled: false);
    final now = _clock();
    if (_lastKeyAt == null || now.difference(_lastKeyAt!) > gap) _buffer.clear();
    _lastKeyAt = now;

    if (event.logicalKey == LogicalKeyboardKey.enter || event.logicalKey == LogicalKeyboardKey.numpadEnter) {
      final code = _buffer.toString();
      _buffer.clear();
      return code.length >= minLength ? (code: code, handled: true) : (code: null, handled: false);
    }

    final character = event.character;
    if (character == null || character.length != 1 || character.codeUnitAt(0) < 0x21) return (code: null, handled: false);
    _buffer.write(character);
    return (code: null, handled: false);
  }
}
