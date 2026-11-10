import 'dart:math';

import '../core/errors.dart';

class PairingCode {
  const PairingCode(this.code, this.expiresAt);

  final String code;
  final DateTime expiresAt;
}

/// One pairing code at a time, held in memory and never persisted: a code that dies
/// with the process is exactly what a "scan this in the next 5 minutes" code should do.
class PairingCodes {
  PairingCodes({DateTime Function()? clock, this.ttl = const Duration(minutes: 5), this.maxWrongGuesses = 5}) : _clock = clock ?? DateTime.now;

  final DateTime Function() _clock;
  final Duration ttl;

  /// Wrong codes the current one survives. Six digits and five guesses leave a guesser
  /// a 1-in-200,000 chance - and the admin just makes a new QR.
  final int maxWrongGuesses;
  PairingCode? _current;
  int _wrongGuesses = 0;

  /// Generating a new code silently retires whatever code was showing before.
  PairingCode generate() {
    final code = Random.secure().nextInt(1000000).toString().padLeft(6, '0');
    final pairing = PairingCode(code, _clock().add(ttl));

    _current = pairing;
    _wrongGuesses = 0;

    return pairing;
  }

  /// Redeems a code. A wrong code does not burn the right one, so a typo does not
  /// force the admin to make a new QR - until [maxWrongGuesses] of them, which retire
  /// it. The right code is single-use either way.
  void consume(String code) {
    final current = _current;

    if (current == null) {
      throw UnauthorizedException('Kode pairing tidak valid.');
    }

    if (current.code != code) {
      if (++_wrongGuesses >= maxWrongGuesses) {
        _current = null;

        throw UnauthorizedException('Terlalu banyak kode salah. Buat kode pairing baru di PC.');
      }

      throw UnauthorizedException('Kode pairing tidak valid.');
    }

    _current = null;

    if (current.expiresAt.isBefore(_clock())) {
      throw UnauthorizedException('Kode pairing sudah kedaluwarsa.');
    }
  }
}
