/// Money is integer cents; quantities are integer thousandths internally.
int moneyInput(String text) {
  final raw = text.trim().replaceAll(',', '.');
  if (!RegExp(r'^\d+(\.\d{1,2})?$').hasMatch(raw)) {
    throw const FormatException('Masukkan rupiah tanpa pemisah ribuan, maksimal 2 desimal.');
  }
  final parts = raw.split('.');
  final result = int.parse(parts[0]) * 100 +
      (parts.length == 2 ? int.parse(parts[1].padRight(2, '0')) : 0);
  if (result > 10000000000000) throw const FormatException('Nilai uang terlalu besar.');
  return result;
}
int qtyInput(String text, {bool allowZero = false}) {
  final value = double.tryParse(text.trim().replaceAll(',', '.'));
  if (value == null || !value.isFinite || value < 0 || value > 1000000000) {
    throw const FormatException('Jumlah harus berupa angka valid dan tidak negatif.');
  }
  final result = (value * 1000).round();
  if (!allowZero && result <= 0) throw const FormatException('Jumlah harus lebih dari 0.');
  return result;
}
String qty(int milli) {
  final raw = (milli / 1000).toStringAsFixed(3);
  return raw.replaceFirst(RegExp(r'\.?0+$'), '').replaceAll('.', ',');
}
String money(int cents) {
  final absolute = cents.abs();
  final integer = (absolute ~/ 100).toString().replaceAllMapped(
    RegExp(r'(\d)(?=(\d{3})+(?!\d))'), (m) => '${m[1]}.');
  final fraction = absolute % 100;
  return '${cents < 0 ? '-' : ''}Rp$integer${fraction == 0 ? '' : ',${fraction.toString().padLeft(2, '0')}'}';
}
String moneyField(int cents) => (cents / 100).toStringAsFixed(cents % 100 == 0 ? 0 : 2);
String dateText(DateTime date) => '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}/${date.year}';
String timeText(DateTime date) => '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
String errorText(Object e) => e is FormatException ? e.message : e.toString();
