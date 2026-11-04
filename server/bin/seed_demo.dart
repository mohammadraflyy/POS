import 'dart:io';

import 'package:pos_server/pos_server.dart';
import 'package:pos_server/src/core/errors.dart';
import 'package:pos_server/src/db/demo_seed.dart';

const _usage = '''
Isi database KOSONG dengan data dummy untuk mencoba aplikasi: 32 produk, supplier,
pelanggan, pembelian 2 bulan terakhir, penjualan 30 hari terakhir, bon, dan pengeluaran.

  dart run bin/seed_demo.dart [--db <database>] [--seed <angka>]

  --db     database tujuan (default: demo.sqlite). Ditolak kalau sudah berisi produk.
  --seed   angka acak; seed yang sama menghasilkan data yang sama (default: 42).

Akun: admin/admin, kasir1/kasir1, kasir2/kasir2.
''';

void main(List<String> args) {
  String? option(String name) {
    final index = args.indexOf(name);

    return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
  }

  if (args.contains('--help')) {
    stdout.write(_usage);
    return;
  }

  final dbPath = option('--db') ?? 'demo.sqlite';
  final seed = int.tryParse(option('--seed') ?? '42') ?? 42;
  final db = Db.open(dbPath);

  try {
    final counts = seedDemoData(db, seed: seed);

    stdout.writeln('Data dummy dibuat di ${File(dbPath).absolute.path}:');

    for (final entry in counts.entries) {
      stdout.writeln('  ${entry.key.padRight(26)} ${entry.value}');
    }

    stdout.writeln('\nLogin: admin/admin, kasir1/kasir1, kasir2/kasir2');
  } on BusinessException catch (error) {
    stderr.writeln(error.message);
    exitCode = 1;
  } finally {
    db.close();
  }
}
