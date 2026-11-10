import 'dart:io';

/// "Open when the PC starts" for the shop PC: the app is the server, so it should be up
/// before the first phone looks for it. The installer switches it on for a new install;
/// this is the owner's switch afterwards. Same registry value the installer writes.
class WindowsStartup {
  const WindowsStartup({this.valueName = 'Point of Sales'});

  /// NSIS's APP_NAME - the installer and the app must agree on it.
  final String valueName;

  static const _runKey = r'HKCU\Software\Microsoft\Windows\CurrentVersion\Run';

  bool get supported => Platform.isWindows;

  Future<bool> isEnabled() async {
    final result = await Process.run('reg', ['query', _runKey, '/v', valueName]);
    return result.exitCode == 0;
  }

  Future<void> setEnabled(bool enabled) async {
    final result = enabled
      ? await Process.run('reg', ['add', _runKey, '/v', valueName, '/t', 'REG_SZ', '/d', '"${Platform.resolvedExecutable}"', '/f'])
      : await Process.run('reg', ['delete', _runKey, '/v', valueName, '/f']);
    if (result.exitCode != 0) throw Exception('Pengaturan Windows tidak bisa diubah.');
  }
}

/// Opens [url] in the PC's browser.
Future<void> openInBrowser(String url) async {
  if (Platform.isWindows) await Process.run('rundll32', ['url.dll,FileProtocolHandler', url]);
}
