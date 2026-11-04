import 'dart:io';

import 'package:pos_server/pos_server.dart';
import 'package:pos_server/src/core/errors.dart';
import 'package:pos_server/src/db/legacy_import.dart';

const _usage = '''
Impor data dari POS desktop (pos.sqlite) ke database server baru.

  dart run bin/import_legacy.dart --from <pos.sqlite lama> [--db <database baru>]

  --from   database POS desktop. Biasanya di %APPDATA%\\point-of-sale\\pos.sqlite.
           File ini hanya dibaca, tidak pernah diubah.
  --db     database server tujuan (default: pos.sqlite di folder ini). Harus masih
           kosong - impor tidak mencampur dua toko.

Tutup aplikasi POS desktop dulu supaya data yang disalin lengkap.
''';

void main(List<String> args) {
  String? option(String name) {
    final index = args.indexOf(name);

    return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
  }

  final from = option('--from');
  final dbPath = option('--db') ?? 'pos.sqlite';

  if (from == null || args.contains('--help')) {
    stdout.write(_usage);
    exitCode = from == null ? 64 : 0;
    return;
  }

  if (!File(from).existsSync()) {
    stderr.writeln('File tidak ditemukan: $from');
    exitCode = 66;
    return;
  }

  if (File(from).absolute.path == File(dbPath).absolute.path) {
    stderr.writeln('--from dan --db tidak boleh file yang sama.');
    exitCode = 64;
    return;
  }

  final db = Db.open(dbPath);

  try {
    final counts = importLegacyDatabase(db, from);

    stdout.writeln('Impor selesai ke ${File(dbPath).absolute.path}:');

    for (final entry in counts.entries) {
      stdout.writeln('  ${entry.key.padRight(26)} ${entry.value}');
    }
  } on BusinessException catch (error) {
    stderr.writeln(error.message);
    exitCode = 1;
  } finally {
    db.close();
  }
}
