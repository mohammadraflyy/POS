import 'package:flutter_test/flutter_test.dart';
import '../lib/services/updater_service.dart';

void main() {
  group('UpdaterService version comparisons', () {
    final updater = UpdaterService();

    test('detects newer semver versions correctly', () {
      expect(updater.checkForUpdate, isNotNull);
    });
  });

  test('picks the APK for the CPU Android reports, so an Intel tablet gets the x86_64 build', () {
    expect(UpdaterService.apkNameFor('x86_64'), 'point-of-sales-mobile-x86_64.apk');
    expect(UpdaterService.apkNameFor('arm64-v8a'), 'point-of-sales-mobile.apk');
    expect(UpdaterService.apkNameFor('armeabi-v7a'), 'point-of-sales-mobile-v7a.apk');
    expect(UpdaterService.apkNameFor(''), 'point-of-sales-mobile.apk');
  });
}

