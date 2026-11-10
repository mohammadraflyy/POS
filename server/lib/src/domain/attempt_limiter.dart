import '../core/errors.dart';

/// Locks a name (a username, or "pairing") for a while after too many failures in a
/// row. Once the shop PC is reachable from the internet, anyone could keep guessing a
/// password; five tries per [lockFor] makes that hopeless. Held in memory: a restart
/// clears it, which only helps the shop owner who locked themselves out.
class AttemptLimiter {
  AttemptLimiter({DateTime Function()? clock, this.maxFailures = 5, this.lockFor = const Duration(minutes: 5)}) : _clock = clock ?? DateTime.now;

  final DateTime Function() _clock;
  final int maxFailures;
  final Duration lockFor;
  final _failures = <String, int>{};
  final _lockedUntil = <String, DateTime>{};

  /// Throws [TooManyAttemptsException] while [key] is locked.
  void check(String key) {
    final until = _lockedUntil[key];

    if (until == null) {
      return;
    }

    final now = _clock();

    if (!now.isBefore(until)) {
      _lockedUntil.remove(key);

      return;
    }

    final minutes = (until.difference(now).inSeconds / 60).ceil();

    throw TooManyAttemptsException('Terlalu banyak percobaan yang salah. Coba lagi dalam $minutes menit.');
  }

  /// Counts a failure; the [maxFailures]th locks [key] and starts the count over.
  void fail(String key) {
    final count = (_failures[key] ?? 0) + 1;

    if (count >= maxFailures) {
      _failures.remove(key);
      _lockedUntil[key] = _clock().add(lockFor);
    } else {
      _failures[key] = count;
    }
  }

  void succeed(String key) => _failures.remove(key);

  /// Runs [attempt] for [key]: refused while locked, counted when it throws
  /// [UnauthorizedException], forgotten when it succeeds.
  T guard<T>(String key, T Function() attempt) {
    check(key);

    try {
      final result = attempt();
      succeed(key);

      return result;
    } on UnauthorizedException {
      fail(key);
      rethrow;
    }
  }
}
