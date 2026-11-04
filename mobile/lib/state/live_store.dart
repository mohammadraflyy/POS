import 'dart:async';
import 'package:flutter/foundation.dart';
import '../models/live_models.dart';
import '../services/business_api.dart';
import '../services/mobile_api.dart';
import '../services/mutation_guard.dart';
class LiveStore extends ChangeNotifier {
  LiveStore(this.api, this.guard);
  final BusinessApi api;
  final MutationGuard guard;
  final List<LiveCartItem> items = [];
  num discount = 0;
  ServerPrice? price;
  bool pricing = false;
  String? priceError;
  int _revision = 0;
  int catalogRevision = 0;
  void stockChanged() { catalogRevision++; reprice(); }
  Timer? _debounce;
  bool _closed = false;
  bool get editable => !guard.busy && guard.pending == null;
  bool get canCheckout => editable && guard.ready && items.isNotEmpty && !pricing && price != null && price!.stockEnough;
  void _emit() { if (!_closed) notifyListeners(); }
  void put(LiveCartItem item) {
    if (!editable) throw const ApiFailure('Selesaikan pemeriksaan transaksi sebelumnya terlebih dahulu.');
    if (item.quantity <= 0 || !item.quantity.isFinite) throw const ApiFailure('Jumlah harus lebih dari 0.');
    final index = items.indexWhere((i) => i.key == item.key);
    if (index < 0) { items.add(item); } else { items[index] = item; }
    reprice();
  }
  void remove(LiveCartItem item) { if (!editable) return; items.remove(item); reprice(); }
  void setDiscount(num value) { if (!editable) return; discount = value; reprice(); }
  void clear() { if (!editable) return; items.clear(); discount = 0; reprice(); }
  void reprice() {
    _debounce?.cancel(); final revision = ++_revision;
    price = null; priceError = null;
    if (items.isEmpty) { discount = 0; pricing = false; _emit(); return; }
    pricing = true; _emit();
    _debounce = Timer(const Duration(milliseconds: 220), () => _price(revision));
  }
  Future<void> _price(int revision) async {
    try {
      final result = await api.price(List.of(items), discount);
      if (_closed || revision != _revision) return;
      if (result.lines.length != items.length) throw const ApiFailure('Jumlah baris harga dari PC tidak sesuai keranjang.');
      price = result;
    } catch (e) { if (!_closed && revision == _revision) priceError = e.toString(); }
    finally { if (!_closed && revision == _revision) { pricing = false; _emit(); } }
  }
  /// [print] false saves the sale without a receipt; the server answers printSkipped.
  Future<Map<String, dynamic>> checkout(String method, num paid, String customer, {bool print = true}) async {
    if (!canCheckout) throw const ApiFailure('Tunggu harga terbaru dan perbaiki baris dengan stok kurang.');
    final payload = <String, dynamic>{
      'metodePembayaran': method, 'namaPelanggan': customer.trim().isEmpty ? null : customer.trim(),
      'dibayar': paid, 'diskon': discount, 'items': items.map((i) => i.toJson()).toList(),
      if (!print) 'cetak': false,
    };
    late Map<String, dynamic> result;
    try {
      result = await guard.run('Penjualan', () async {
      final response = await api.checkout(payload);
      idNumber(response['saleId']);
      if (number(response['total']) == null || response['printed'] is! bool) {
        throw const ApiFailure('Respons checkout tidak lengkap. Periksa riwayat PC.');
      }
      return response;
      });
    } on ApiFailure catch (e) {
      if (e.statusCode == 400) reprice();
      rethrow;
    }
    // Already committed: clear cart even if the printer reports failure.
    items.clear(); discount = 0; price = null; priceError = null; _revision++; catalogRevision++; _emit();
    return result;
  }
  @override void dispose() { _closed = true; _debounce?.cancel(); super.dispose(); }
}
