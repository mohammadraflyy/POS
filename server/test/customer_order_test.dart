import 'package:pos_server/src/db/db.dart';
import 'package:pos_server/src/domain/parties.dart';
import 'package:test/test.dart';

import 'support/fixtures.dart';

void main() {
  test('customer names come newest buyer first, then the rest by name', () {
    final db = seedDb();
    final now = nowSeconds();
    db.insert(
      "INSERT INTO customers (id, nama, created_at, updated_at) VALUES (1, 'Andi', ?, ?), (2, 'Budi', ?, ?), (3, 'Citra', ?, ?), (4, 'Dewi', ?, ?)",
      [now, now, now, now, now, now, now, now],
    );
    for (final (customer, at) in [(3, now - 300), (2, now - 100), (3, now - 900)]) {
      db.insert(
        "INSERT INTO sales (user_id, customer_id, metode_pembayaran, created_at, updated_at) VALUES (1, ?, 'tunai', ?, ?)",
        [customer, at, at],
      );
    }

    expect(listCustomerNames(db), ['Budi', 'Citra', 'Andi', 'Dewi']);
    db.close();
  });
}
