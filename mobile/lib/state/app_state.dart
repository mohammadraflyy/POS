import 'dart:convert';
import 'package:flutter/foundation.dart';
import '../models/pos_models.dart';
import '../services/demo_store.dart';
import '../services/mobile_api.dart';
import '../services/session_storage.dart';

enum AppMode { pairing, demo, connected }
class AppState extends ChangeNotifier {
  AppState({MobileApi? api, SessionStorage? storage}): api = api ?? MobileApi(), storage = storage ?? SecureSessionStorage();
  final MobileApi api;
  final SessionStorage storage;
  AppMode mode = AppMode.pairing;
  bool busy = false, initializing = true;
  String? notice;
  String userName = '', role = '', userId = '';
  Uri? address;
  String? _token;
  int _generation = 0;
  DemoStore demo = DemoStore();
  final List<CartLine> cart = [];
  int billDiscount = 0;
  bool get isDemo => mode == AppMode.demo;
  bool get hasStoredSession => _token != null && address != null;
  int get subtotal => cart.fold<int>(0, (sum, line) => sum + line.total);
  int get total => subtotal - billDiscount;

  Future<void> restore() async {
    busy = true;
    notifyListeners();
    try {
      final saved = await storage.read();
      if (saved != null) {
        final data = jsonDecode(saved) as Map<String, dynamic>;
        address = parseAddress(data['address'] as String);
        _token = data['token'] as String;
        await _validateSession();
        mode = AppMode.connected; notice = null;
      }
    } catch (e) {
      notice = e is ApiFailure ? e.message : 'Sesi tersimpan tidak dapat dibuka. Hubungkan ulang perangkat.';
      if (e is ApiFailure && e.unauthorized) await _clearCredentials();
      mode = AppMode.pairing;
    } finally {
      initializing = false; busy = false; notifyListeners();
    }
  }
  Future<void> connect({required String host, required String code,
    required String username, required String password, required String deviceName}) async {
    if (busy) return;
    if (!RegExp(r'^\d{6}$').hasMatch(code) || username.trim().isEmpty || password.isEmpty) {
      throw const ApiFailure('Isi kode 6 digit, username, dan password.');
    }
    busy = true; notice = null; notifyListeners();
    try {
      final base = parseAddress(host);
      await api.health(base);
      final paired = await api.pair(base, code, username.trim(), password, deviceName.trim());
      final token = paired['token'];
      if (token is! String || token.isEmpty) throw const ApiFailure('Token pairing tidak ditemukan.');
      final identity = await api.me(base, token);
      final user = _readUser(identity);
      await storage.write(jsonEncode({'address': base.toString(), 'token': token}));
      _generation++;
      address = base; _token = token;
      userName = user['name']?.toString() ?? user['username'].toString();
      role = user['role'].toString(); userId = (user['id'] ?? user['username']).toString();
      cart.clear(); billDiscount = 0;
      mode = AppMode.connected;
    } finally { busy = false; notifyListeners(); }
  }
  /// Signs in with an account directly - no pairing code. Used on the shop PC (server at
  /// 127.0.0.1) and by an admin whose own device has no QR to scan.
  Future<void> login({required String host, required String username, required String password, required String deviceName}) async {
    if (busy) return;
    if (username.trim().isEmpty || password.isEmpty) throw const ApiFailure('Isi username dan password.');
    busy = true; notice = null; notifyListeners();
    try {
      final base = parseAddress(host);
      await api.health(base);
      final signed = await api.login(base, username.trim(), password, deviceName.trim());
      final token = signed['token'];
      if (token is! String || token.isEmpty) throw const ApiFailure('Token login tidak ditemukan.');
      final user = _readUser(signed);
      await storage.write(jsonEncode({'address': base.toString(), 'token': token}));
      _generation++;
      address = base; _token = token;
      userName = user['name']?.toString() ?? user['username'].toString();
      role = user['role'].toString(); userId = (user['id'] ?? user['username']).toString();
      cart.clear(); billDiscount = 0;
      mode = AppMode.connected;
    } finally { busy = false; notifyListeners(); }
  }
  bool get isAdmin => mode == AppMode.connected && role == 'admin';
  Map<String, dynamic> _readUser(Map<String, dynamic> data) {
    final user = data['user'];
    if (user is! Map<String, dynamic> || user['username'] == null || user['role'] == null) {
      throw const ApiFailure('Identitas pengguna dari PC tidak lengkap.');
    }
    return user;
  }
  Future<void> _validateSession() async {
    final data = await api.me(address!, _token!);
    final user = _readUser(data);
    userName = user['name']?.toString() ?? user['username'].toString();
    role = user['role'].toString(); userId = (user['id'] ?? user['username']).toString();
  }
  bool _checking = false;
  Future<void> checkConnection() async {
    if (mode != AppMode.connected || _checking) return;
    final generation = _generation;
    _checking = true;
    try {
      final data = await api.me(address!, _token!);
      if (generation != _generation) return;
      final user = _readUser(data);
      userName = user['name']?.toString() ?? user['username'].toString();
      role = user['role'].toString(); userId = (user['id'] ?? user['username']).toString(); notice = null;
    } catch (e) {
      if (generation != _generation) return;
      notice = e.toString();
      if (e is ApiFailure && e.unauthorized) {
        await _clearCredentials(); mode = AppMode.pairing; _generation++;
      }
    } finally { _checking = false; notifyListeners(); }
  }
  Future<void> _clearCredentials() async {
    _token = null;
    try { await storage.clear(); } catch (_) { notice = 'Akses berakhir; penyimpanan perangkat tidak dapat dibersihkan. Coba keluar lagi.'; }
  }
  void startDemo() {
    _generation++; demo = DemoStore(); cart.clear(); billDiscount = 0;
    mode = AppMode.demo; notice = null; userName = 'Kasir Demo'; notifyListeners();
  }
  Future<void> logout() async {
    _generation++; await _clearCredentials();
    mode = AppMode.pairing; cart.clear(); billDiscount = 0; userName = ''; notifyListeners();
  }
  Future<Object?> businessRequest(String path, {required String method,
    Map<String, String>? query, Map<String, dynamic>? body}) async {
    if (mode != AppMode.connected || address == null || _token == null) {
      throw const ApiFailure('Hubungkan perangkat ke PC terlebih dahulu.');
    }
    final generation = _generation;
    try {
      final result = await api.requestRaw(base: address!, path: path, method: method,
        token: _token, query: query, body: body);
      if (generation != _generation) throw const ApiFailure('Sesi perangkat telah berubah.');
      return result;
    } on ApiFailure catch (e) {
      if (e.unauthorized && generation == _generation) {
        notice = e.message; _generation++;
        await _clearCredentials(); mode = AppMode.pairing; notifyListeners();
      }
      rethrow;
    }
  }
  /// File downloads and uploads (Excel exports, imports), under the same session rules
  /// as [businessRequest]: a 401 ends the session.
  Future<FileResponse> businessFile(String path, {String method = 'GET', Map<String, String>? query, List<int>? upload}) async {
    if (mode != AppMode.connected || address == null || _token == null) {
      throw const ApiFailure('Hubungkan perangkat ke PC terlebih dahulu.');
    }
    final generation = _generation;
    try {
      return await api.transferFile(base: address!, path: path, method: method, token: _token, query: query, upload: upload);
    } on ApiFailure catch (e) {
      if (e.unauthorized && generation == _generation) {
        notice = e.message; _generation++;
        await _clearCredentials(); mode = AppMode.pairing; notifyListeners();
      }
      rethrow;
    }
  }
  void requireDemo() {
    if (!isDemo) throw const ApiFailure('Operasi ini hanya untuk mode demo.');
  }
  void putLine(CartLine line) {
    requireDemo();
    final candidate = List<CartLine>.from(cart);
    final index = candidate.indexWhere((l) => l.key == line.key);
    if (index == -1) { candidate.add(line); } else { candidate[index] = line; }
    demo.validateCart(candidate, billDiscount);
    cart..clear()..addAll(candidate); notifyListeners();
  }
  void add(Product product) {
    final key = '${product.id}:${product.baseUnit.id}';
    final index = cart.indexWhere((line) => line.key == key);
    putLine(index == -1 ? CartLine(product: product, unit: product.baseUnit, quantity: 1000)
      : cart[index].copy(quantity: cart[index].quantity + 1000));
  }
  void remove(CartLine line) {
    requireDemo(); cart.removeWhere((l) => l.key == line.key);
    if (billDiscount > subtotal) billDiscount = 0;
    notifyListeners();
  }
  void clearCart() { requireDemo(); cart.clear(); billDiscount = 0; notifyListeners(); }
  void setDiscount(int value) { requireDemo(); demo.validateCart(cart, value); billDiscount = value; notifyListeners(); }
  SaleReceipt checkout(PaymentMethod method, int paid, String customer) {
    requireDemo();
    final receipt = demo.checkout(lines: cart, discount: billDiscount, method: method, tendered: paid, customer: customer);
    cart.clear(); billDiscount = 0; notifyListeners(); return receipt;
  }
  void refreshDemo() { requireDemo(); notifyListeners(); }
}
