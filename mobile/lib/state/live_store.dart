import 'dart:async';
import 'dart:convert';
import '../services/draft_store.dart';
import 'package:flutter/foundation.dart';
import '../models/live_models.dart';
import '../services/business_api.dart';
import '../services/mobile_api.dart';
import '../services/mutation_guard.dart';
class CartQueue {
  CartQueue({
    required this.id,
    required this.name,
    List<LiveCartItem>? items,
    this.customerName = '',
    this.discount = 0,
    this.otherCharge = 0,
    this.note = '',
    this.saleDate,
    this.price,
  }) : items = items ?? [];

  final String id;
  String name;
  final List<LiveCartItem> items;
  String customerName;
  num discount;
  num otherCharge;
  String note;
  DateTime? saleDate;
  ServerPrice? price;

  String get label => customerName.isNotEmpty ? customerName : name;
  int get itemCount => items.fold(0, (acc, item) => acc + (item.quantity.toInt()));
}

class LiveStore extends ChangeNotifier {
  LiveStore(this.api, this.guard, {this.drafts, bool Function()? viaInternet}) : _viaInternet = viaInternet;
  final BusinessApi api;
  final MutationGuard guard;
  final bool Function()? _viaInternet;

  /// The till is outside the shop right now, so a receipt would come out of the shop's
  /// printer, far from the customer.
  bool get viaInternet => _viaInternet?.call() ?? false;

  /// Where the sale in progress is kept between runs; null keeps nothing (tests, demo).
  final DraftStore? drafts;
  Timer? _draftTimer;
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

  /// Chosen at the till with Alt+P, as on the desktop; empty means "Umum".
  String customerName = '';

  void setCustomer(String name) {
    customerName = name.trim();
    if (activeQueueIndex >= 0 && activeQueueIndex < queues.length) {
      queues[activeQueueIndex].customerName = customerName;
    }
    _saveDraft();
    _emit();
  }

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
    _saveDraft();
    _emit();
  }

  // --- Multi-Antrean / Cart Queues ---

  int activeQueueIndex = 0;
  final List<CartQueue> queues = [CartQueue(id: '1', name: 'Antrean 1')];

  CartQueue get activeQueue => queues.isEmpty
      ? CartQueue(id: '1', name: 'Antrean 1')
      : queues[activeQueueIndex.clamp(0, queues.length - 1)];

  void _syncActiveQueue() {
    if (activeQueueIndex >= 0 && activeQueueIndex < queues.length) {
      final q = queues[activeQueueIndex];
      q.items.clear();
      q.items.addAll(items);
      q.customerName = customerName;
      q.discount = discount;
      q.otherCharge = otherCharge;
      q.note = note;
      q.saleDate = saleDate;
      q.price = price;
    }
  }

  void _loadFromQueue(CartQueue q) {
    items.clear();
    items.addAll(q.items);
    customerName = q.customerName;
    discount = q.discount;
    otherCharge = q.otherCharge;
    note = q.note;
    saleDate = q.saleDate;
    price = q.price;
    _revision++;
    reprice();
  }

  void switchQueue(int index) {
    if (index == activeQueueIndex || index < 0 || index >= queues.length) return;
    _syncActiveQueue();
    activeQueueIndex = index;
    _loadFromQueue(queues[index]);
    _saveDraft();
    _emit();
  }

  void newQueue({String? name}) {
    _syncActiveQueue();
    final nextNum = queues.length + 1;
    final q = CartQueue(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      name: name ?? 'Antrean $nextNum',
    );
    queues.add(q);
    activeQueueIndex = queues.length - 1;
    _loadFromQueue(q);
    _saveDraft();
    _emit();
  }

  bool removeQueue(int index) {
    if (queues.length <= 1) {
      clear();
      return false;
    }
    if (index < 0 || index >= queues.length) return false;

    _syncActiveQueue();
    queues.removeAt(index);
    if (activeQueueIndex >= queues.length) {
      activeQueueIndex = queues.length - 1;
    } else if (activeQueueIndex > index) {
      activeQueueIndex--;
    }
    _loadFromQueue(queues[activeQueueIndex]);
    _saveDraft();
    _emit();
    return true;
  }

  /// Tahan transaksi saat ini dan buat antrean baru
  bool holdCart({String? label}) {
    if (items.isEmpty || editingSaleId != null) return false;
    newQueue(name: label);
    return true;
  }

  // --- the draft: the sale in progress survives a closed app, as on the desktop ---

  Map<String, dynamic> _draftJson() {
    _syncActiveQueue();
    return {
      'activeQueueIndex': activeQueueIndex,
      'queues': [
        for (final q in queues) {
          'id': q.id,
          'name': q.name,
          'items': [for (final i in q.items) {
            'product': {'id': i.product.id, 'name': i.product.name, 'code': i.product.code, 'barcode': i.product.barcode,
              'units': [for (final u in i.product.units) {'id': u.id, 'name': u.name, 'price': u.price, 'cost': u.cost, 'conversionFactor': u.conversionFactor}]},
            'unitId': i.unit.id, 'qty': i.quantity, 'manualPrice': i.manualPrice, 'discount': i.discount,
          }],
          'discount': q.discount, 'otherCharge': q.otherCharge, 'note': q.note, 'customer': q.customerName,
          if (q.saleDate != null) 'saleDate': q.saleDate!.toIso8601String(),
        }
      ],
      'items': [for (final i in items) {
        'product': {'id': i.product.id, 'name': i.product.name, 'code': i.product.code, 'barcode': i.product.barcode,
          'units': [for (final u in i.product.units) {'id': u.id, 'name': u.name, 'price': u.price, 'cost': u.cost, 'conversionFactor': u.conversionFactor}]},
        'unitId': i.unit.id, 'qty': i.quantity, 'manualPrice': i.manualPrice, 'discount': i.discount,
      }],
      'discount': discount, 'otherCharge': otherCharge, 'note': note, 'customer': customerName,
      if (saleDate != null) 'saleDate': saleDate!.toIso8601String(),
    };
  }

  /// Saves shortly after a change; never while a saved nota is being edited (that one
  /// lives on the server already). An empty sale removes the draft.
  void _saveDraft() {
    final store = drafts;
    if (store == null || editingSaleId != null || _closed) return;
    _draftTimer?.cancel();
    _draftTimer = Timer(const Duration(milliseconds: 300), _writeDraft);
  }

  Future<void> _writeDraft() async {
    final store = drafts;
    if (store == null || editingSaleId != null) return;
    try {
      _syncActiveQueue();
      final allEmpty = queues.every((q) => q.items.isEmpty && q.discount == 0 && q.otherCharge == 0 && q.note.trim().isEmpty && q.saleDate == null && q.customerName.isEmpty);
      if (allEmpty && items.isEmpty && discount == 0 && otherCharge == 0 && note.trim().isEmpty && saleDate == null && customerName.isEmpty) {
        await store.clear();
      } else {
        await store.write(jsonEncode(_draftJson()));
      }
    } catch (_) {
      // the till keeps working without its draft; the next change tries again
    }
  }

  List<LiveCartItem> _parseCartLines(List? raw) {
    final lines = <LiveCartItem>[];
    for (final entry in (raw ?? const []).whereType<Map>()) {
      final p = Map<String, dynamic>.from(entry['product'] as Map);
      final units = [
        for (final u in (p['units'] as List).whereType<Map>())
          LiveUnit(
            u['id'] as int?,
            u['name'] as String,
            u['price'] as num?,
            cost: u['cost'] as num?,
            conversionFactor: (u['conversionFactor'] as int?) ?? 1,
          ),
      ];
      final product = LiveProduct(p['id'] as int, p['name'] as String, p['code'] as String? ?? '', null, units, barcode: p['barcode'] as String?);
      final unit = units.firstWhere((u) => u.id == entry['unitId'], orElse: () => units.first);
      lines.add(LiveCartItem(
        product: product,
        unit: unit,
        quantity: entry['qty'] as num,
        manualPrice: entry['manualPrice'] as num?,
        discount: entry['discount'] as num?,
      ));
    }
    return lines;
  }

  int _applyDraftData(Map<String, dynamic> data) {
    if (data['queues'] is List && (data['queues'] as List).isNotEmpty) {
      queues.clear();
      for (final rawQ in (data['queues'] as List).whereType<Map>()) {
        final qItems = _parseCartLines(rawQ['items'] as List?);
        final q = CartQueue(
          id: rawQ['id']?.toString() ?? DateTime.now().millisecondsSinceEpoch.toString(),
          name: rawQ['name']?.toString() ?? 'Antrean ${queues.length + 1}',
          items: qItems,
          customerName: (rawQ['customer'] as String?) ?? '',
          discount: (rawQ['discount'] as num?) ?? 0,
          otherCharge: (rawQ['otherCharge'] as num?) ?? 0,
          note: (rawQ['note'] as String?) ?? '',
          saleDate: rawQ['saleDate'] == null ? null : DateTime.tryParse(rawQ['saleDate'] as String),
        );
        queues.add(q);
      }
      final targetIdx = (data['activeQueueIndex'] as num? ?? 0).toInt();
      activeQueueIndex = (targetIdx >= 0 && targetIdx < queues.length) ? targetIdx : 0;
      _loadFromQueue(queues[activeQueueIndex]);
      return items.length;
    }

    final lines = _parseCartLines(data['items'] as List?);
    if (_closed) return 0;
    items.clear();
    items.addAll(lines);
    discount = data['discount'] as num? ?? 0;
    otherCharge = data['otherCharge'] as num? ?? 0;
    note = data['note'] as String? ?? '';
    customerName = data['customer'] as String? ?? '';
    saleDate = data['saleDate'] == null ? null : DateTime.tryParse(data['saleDate'] as String);
    queues.clear();
    queues.add(CartQueue(
      id: '1',
      name: 'Antrean 1',
      items: List.of(items),
      customerName: customerName,
      discount: discount,
      otherCharge: otherCharge,
      note: note,
      saleDate: saleDate,
    ));
    activeQueueIndex = 0;
    reprice();
    _emit();
    return lines.length;
  }

  /// Puts back the sale that was in progress when the app last closed. Returns how many
  /// lines came back. A draft that cannot be read is dropped rather than half-restored.
  Future<int> restoreDraft() async {
    final store = drafts;
    if (store == null || items.isNotEmpty) return 0;
    try {
      final raw = await store.read();
      if (raw == null || raw.isEmpty) return 0;
      final data = jsonDecode(raw) as Map<String, dynamic>;
      return _applyDraftData(data);
    } catch (_) {
      await store.clear();
      return 0;
    }
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

  void _resetDetails() { editingSaleId = null; saleDate = null; otherCharge = 0; note = ''; customerName = ''; }

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
    // New items land at index 0 so F3 (editTopLine) always edits the most recently added item, matching desktop-node.
    if (index < 0) { items.insert(0, item); } else { items[index] = item; }
    reprice();
  }
  void replace(LiveCartItem oldItem, LiveCartItem newItem) {
    if (!editable) throw const ApiFailure('Selesaikan pemeriksaan transaksi sebelumnya terlebih dahulu.');
    if (newItem.quantity <= 0 || !newItem.quantity.isFinite) throw const ApiFailure('Jumlah harus lebih dari 0.');
    if (oldItem.key == newItem.key) { put(newItem); return; }
    final oldIdx = items.indexWhere((i) => i.key == oldItem.key);
    final dupIdx = items.indexWhere((i) => i.key == newItem.key);
    if (dupIdx >= 0) {
      final existing = items[dupIdx];
      items[dupIdx] = LiveCartItem(
        product: existing.product,
        unit: existing.unit,
        quantity: existing.quantity + newItem.quantity,
        manualPrice: newItem.manualPrice ?? existing.manualPrice,
        discount: (existing.discount ?? 0) + (newItem.discount ?? 0) > 0
            ? (existing.discount ?? 0) + (newItem.discount ?? 0)
            : null,
      );
      if (oldIdx >= 0) items.removeAt(oldIdx > dupIdx ? oldIdx : oldIdx);
    } else if (oldIdx >= 0) {
      items[oldIdx] = newItem;
    } else {
      items.insert(0, newItem);
    }
    reprice();
  }
  void remove(LiveCartItem item) { if (!editable) return; items.remove(item); reprice(); }
  void setDiscount(num value) { if (!editable) return; discount = value; reprice(); }
  void clear() { if (!editable) return; items.clear(); discount = 0; _resetDetails(); _syncActiveQueue(); reprice(); }
  void reprice() {
    _saveDraft();
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
    if (queues.length > 1) {
      queues.removeAt(activeQueueIndex);
      if (activeQueueIndex >= queues.length) activeQueueIndex = queues.length - 1;
      _loadFromQueue(queues[activeQueueIndex]);
    } else {
      items.clear(); discount = 0; _resetDetails(); price = null; priceError = null; _revision++; catalogRevision++;
    }
    _emit();
    // the sale is on the server now: the draft has done its job
    _draftTimer?.cancel();
    try { await drafts?.clear(); } catch (_) {}
    return result;
  }
  @override void dispose() {
    // a change made in the last moments before closing still lands in the draft
    if (_draftTimer?.isActive ?? false) { _draftTimer!.cancel(); _writeDraft(); }
    _closed = true; _debounce?.cancel(); super.dispose();
  }
}
