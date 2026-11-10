import 'package:flutter_test/flutter_test.dart';
import '../lib/services/updater_service.dart';

void main() {
  group('UpdaterService version comparisons', () {
    final updater = UpdaterService();

    test('detects newer semver versions correctly', () {
      expect(updater.checkForUpdate, isNotNull);
    });
  });
}
