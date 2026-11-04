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

  // --- the nota's own details, as on the desktop's payment dialog ---

  /// Null files the sale under the moment it is saved; set it for a sale meant for another
  /// day (a bon written for tomorrow, a sale rung up late).
  DateTime? saleDate;

  /// A charge added to the bill (delivery, a bag), in rupiah.
  num otherCharge = 0;
  String note = '';

  // --- editing a saved sale ---

  /// Set while the cart holds a saved nota being changed; checkout then rewrites it.
  int? editingSaleId;
  String editMethod = 'tunai', editCustomer = '';
  num editPaid = 0;

  /// What the customer pays: the server's priced total plus the charge.
  num? get billTotal => price == null ? null : price!.total + otherCharge;

  void setDetails({DateTime? date, bool clearDate = false, num? charge, String? text}) {
    if (clearDate) { saleDate = null; } else if (date != null) { saleDate = date; }
    if (charge != null) otherCharge = charge;
    if (text != null) note = text;
    _emit();
  }

  /// Loads a saved nota into the cart, keeping each line's price as it was sold - an edit
  /// must not quietly reprice an old sale - and its date, charge and note.
  void startEdit({required int saleId, required List<LiveCartItem> lines, required DateTime date,
      required String method, required String customer, required num paid, required num charge, required String text, required num billDiscount}) {
    if (!editable) throw const ApiFailure('Selesaikan pemeriksaan transaksi sebelumnya terlebih dahulu.');
    items..clear()..addAll(lines);
    editingSaleId = saleId; saleDate = date; otherCharge = charge; note = text;
    editMethod = method; editCustomer = customer; editPaid = paid; discount = billDiscount;
    reprice();
  }

  void cancelEdit() {
    editingSaleId = null; saleDate = null; otherCharge = 0; note = '';
    items.clear(); discount = 0; reprice();
  }

  void _resetDetails() { editingSaleId = null; saleDate = null; otherCharge = 0; note = ''; }

  static String _localStamp(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}T${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
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
  void clear() { if (!editable) return; items.clear(); discount = 0; _resetDetails(); reprice(); }
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
    final editing = editingSaleId;
    final payload = <String, dynamic>{
      'metodePembayaran': method, 'namaPelanggan': customer.trim().isEmpty ? null : customer.trim(),
      'dibayar': paid, 'diskon': discount, 'items': items.map((i) => i.toJson()).toList(),
      if (!print && editing == null) 'cetak': false,
      // an edit must name its date; a new sale without one is filed under now
      if (saleDate != null || editing != null) 'tanggal': _localStamp(saleDate ?? DateTime.now()),
      'biayaLain': otherCharge,
      'keterangan': note.trim().isEmpty ? null : note.trim(),
    };
    late Map<String, dynamic> result;
    try {
      result = await guard.run(editing == null ? 'Penjualan' : 'Ubah nota #$editing', () async {
      if (editing != null) {
        final saved = jsonObject(await api.request('/v1/sales/$editing', method: 'PUT', body: payload));
        return <String, dynamic>{'saleId': editing, 'total': saved['total'], 'printed': false, 'edited': true};
      }
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
    items.clear(); discount = 0; _resetDetails(); price = null; priceError = null; _revision++; catalogRevision++; _emit();
    return result;
  }
  @override void dispose() { _closed = true; _debounce?.cancel(); super.dispose(); }
}
