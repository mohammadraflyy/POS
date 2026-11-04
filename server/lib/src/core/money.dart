/// Money is stored as whole cents in the database and spoken as rupiah over HTTP.
/// Domain code always works in cents; only the HTTP edge converts.
library;

double toRupiah(int cents) => cents / 100;

int toCents(num rupiah) => (rupiah * 100).round();

/// Rupiah for JSON: whole amounts go out as ints so `130000` stays `130000`, not `130000.0`.
num rupiahJson(int cents) => cents % 100 == 0 ? cents ~/ 100 : cents / 100;

/// Rupiah for JSON from a cents figure that may itself be fractional (qty x cost on a
/// fractional qty), normalized so whole amounts still go out as ints.
num rupiahJsonNum(num cents) {
  final rupiah = cents / 100;

  return rupiah == rupiah.truncateToDouble() ? rupiah.toInt() : rupiah;
}
