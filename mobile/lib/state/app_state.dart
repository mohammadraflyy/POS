import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import '../models/pos_models.dart';
import '../services/demo_store.dart';
import '../services/mobile_api.dart';
import '../services/session_storage.dart';
import '../services/tailnet_client.dart';

enum AppMode { pairing, demo, connected }
class AppState extends ChangeNotifier {
  AppState({MobileApi? api, SessionStorage? storage, TailnetClient? tailnet, this.keyLifetime = const Duration(minutes: 50)})
    : api = api ?? MobileApi(), storage = storage ?? SecureSessionStorage(), tailnet = tailnet ?? PosnetClient() {
    _joinedSub = this.tailnet.joined.listen((_) => _markJoined());
  }
  final MobileApi api;
  final SessionStorage storage;

  /// Reaches the PC from outside the shop (Tailscale, inside the app).
  final TailnetClient tailnet;

  /// How long a key from the PC stays usable here: the PC mints them for an hour.
  final Duration keyLifetime;
  StreamSubscription<void>? _joinedSub;
  AppMode mode = AppMode.pairing;
  bool busy = false, initializing = true;
  String? notice;
  String userName = '', role = '', userId = '';

  /// The PC on the shop's Wi-Fi.
  Uri? address;
  String? _token;
  String deviceName = '';

  /// The PC on the shop's tailnet (`100.x.y.z:48950`), once the PC has given this phone
  /// a way in; null while access from outside the shop is off.
  String? remoteAddress;
  String? _remoteKey;
  DateTime? _remoteKeyIssued;
  bool _remoteJoined = false;

  /// Requests go over the internet right now, because the shop's Wi-Fi is out of reach.
  bool viaInternet = false;
  int _generation = 0;
  DemoStore demo = DemoStore();
  final List<CartLine> cart = [];
  int billDiscount = 0;
  bool get isDemo => mode == AppMode.demo;
  bool get hasStoredSession => _token != null && address != null;

  /// The shop's name and logo from the PC, shown in the shell; null until loaded or when
  /// the shop has not set one, and the default mark stands in.
  String? shopName;
  Uint8List? shopLogo;
  Object? _logoVersion;

  /// Reads the shop's name and, when it changed, its logo. Failures leave what was shown.
  Future<void> refreshBranding() async {
    if (mode != AppMode.connected) return;
    final generation = _generation;
    try {
      final settings = await businessRequest('/v1/settings', method: 'GET');
      if (settings is! Map || generation != _generation) return;
      shopName = settings['namaToko']?.toString();
      final version = settings['logoVersion'];
      if (version == null) {
        shopLogo = null;
      } else if (version != _logoVersion || shopLogo == null) {
        final file = await businessFile('/v1/settings/logo');
        if (generation != _generation) return;
        shopLogo = Uint8List.fromList(file.bytes);
      }
      _logoVersion = version;
      notifyListeners();
    } catch (_) {
      // the shell works without it
    }
  }
  void _clearBranding() { shopName = null; shopLogo = null; _logoVersion = null; }

  /// This phone can reach the PC from outside the shop.
  bool get hasRemoteAccess => remoteAddress != null && tailnet.supported;
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
        deviceName = data['deviceName']?.toString() ?? '';
        final remote = data['remote'];
        if (remote is Map) {
          remoteAddress = remote['address']?.toString();
          _remoteKey = remote['authKey']?.toString();
          _remoteKeyIssued = DateTime.tryParse(remote['keyIssuedAt']?.toString() ?? '');
          _remoteJoined = remote['joined'] == true;
        }
        await _validateSession();
        mode = AppMode.connected; notice = null;
        unawaited(_maintainRemote());
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
      await _signedIn(base, token, deviceName.trim(), _readUser(identity));
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
      await _signedIn(base, token, deviceName.trim(), _readUser(signed));
    } finally { busy = false; notifyListeners(); }
  }
  Future<void> _signedIn(Uri base, String token, String name, Map<String, dynamic> user) async {
    await _forgetRemote();
    address = base; _token = token; deviceName = name; _clearBranding();
    await _save();
    _generation++;
    userName = user['name']?.toString() ?? user['username'].toString();
    role = user['role'].toString(); userId = (user['id'] ?? user['username']).toString();
    cart.clear(); billDiscount = 0;
    mode = AppMode.connected;
    unawaited(_maintainRemote());
  }
  Future<void> _save() => storage.write(jsonEncode({
    'address': address.toString(), 'token': _token, 'deviceName': deviceName,
    if (remoteAddress != null) 'remote': {
      'address': remoteAddress, 'authKey': _remoteKey, 'keyIssuedAt': _remoteKeyIssued?.toIso8601String(), 'joined': _remoteJoined,
    },
  }));
  bool get isAdmin => mode == AppMode.connected && role == 'admin';
  Map<String, dynamic> _readUser(Map<String, dynamic> data) {
    final user = data['user'];
    if (user is! Map<String, dynamic> || user['username'] == null || user['role'] == null) {
      throw const ApiFailure('Identitas pengguna dari PC tidak lengkap.');
    }
    return user;
  }
  Future<void> _validateSession() async {
    final data = await _routed((base) => api.me(base, _token!));
    final user = _readUser(data);
    userName = user['name']?.toString() ?? user['username'].toString();
    role = user['role'].toString(); userId = (user['id'] ?? user['username']).toString();
  }

  // --- the way to the PC: the shop's Wi-Fi, or the internet when that is out of reach ---

  /// Sends [call] the way that works right now. When the PC cannot be reached at all -
  /// so nothing was sent - it switches to the other way and tries once more.
  Future<T> _routed<T>(Future<T> Function(Uri base) call) async {
    if (!viaInternet || !hasRemoteAccess) {
      try {
        final result = await call(address!);
        if (viaInternet) { viaInternet = false; notifyListeners(); }
        return result;
      } on ApiFailure catch (e) {
        if (!e.unreachable || !hasRemoteAccess) rethrow;
        final result = await _callRemote(call);
        if (!viaInternet) { viaInternet = true; notifyListeners(); }
        return result;
      }
    }
    return _callRemote(call);
  }
  Future<T> _callRemote<T>(Future<T> Function(Uri base) call) async {
    try {
      return await call(await _remoteBase());
    } on ApiFailure catch (e) {
      if (!e.unreachable) rethrow;
      // posnet itself is gone; start it again
      await tailnet.stop();
      return call(await _remoteBase());
    }
  }
  Future<Uri> _remoteBase() async {
    final port = await tailnet.start(target: remoteAddress!, hostname: _tailnetHostname(), authKey: _remoteJoined ? null : _remoteKey);
    return Uri(scheme: 'http', host: '127.0.0.1', port: port);
  }
  String _tailnetHostname() {
    final name = deviceName.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]+'), '-').replaceAll(RegExp(r'^-+|-+$'), '');
    final cut = name.length > 40 ? name.substring(0, 40) : name;
    return cut.isEmpty ? 'pos-hp' : 'pos-hp-$cut';
  }
  void _markJoined() {
    if (_remoteJoined || remoteAddress == null) return;
    _remoteJoined = true; _remoteKey = null; _remoteKeyIssued = null;
    unawaited(_save().catchError((Object _) {}));
  }

  bool _maintainingRemote = false;

  /// While on the shop's Wi-Fi, keeps this phone's way in from outside in step with the
  /// PC: asks for it when the PC offers it, drops it when the PC switched it off. Out of
  /// the shop, looks for the Wi-Fi again so requests go back the short way.
  Future<void> _maintainRemote() async {
    if (_maintainingRemote || !tailnet.supported || mode != AppMode.connected || address == null || _token == null) return;
    _maintainingRemote = true;
    final generation = _generation;
    try {
      if (viaInternet) {
        await api.health(address!);
        if (generation == _generation) { viaInternet = false; notifyListeners(); }
        return;
      }
      final status = await api.request(base: address!, path: '/v1/server/status', token: _token);
      final remote = status['remote'];
      if (generation != _generation || remote is! Map) return;
      if (remote['enabled'] != true) {
        if (remoteAddress != null) { await _forgetRemote(); await _save(); notifyListeners(); }
        return;
      }
      final pcAddress = remote['address'];
      final issued = _remoteKeyIssued;
      final keyFresh = _remoteKey != null && issued != null && DateTime.now().difference(issued) < keyLifetime;
      final needsKey = pcAddress != remoteAddress || (!_remoteJoined && !keyFresh);
      if (remote['online'] != true || pcAddress is! String || !needsKey) return;
      final grant = await api.request(base: address!, path: '/v1/remote-access/grant', method: 'POST', token: _token, body: {'deviceName': deviceName});
      final grantedAddress = grant['address'], key = grant['authKey'];
      if (generation != _generation || grantedAddress is! String || key is! String) return;
      // a PC that joined anew may sit on another tailnet: this phone joins anew as well
      if (grantedAddress != remoteAddress) await _forgetRemote();
      remoteAddress = grantedAddress; _remoteKey = key; _remoteKeyIssued = DateTime.now(); _remoteJoined = false;
      await _save();
      notifyListeners();
      // join now, while the key is fresh, rather than the first time the Wi-Fi is gone
      unawaited(_remoteBase().then((_) {}, onError: (Object _) {}));
    } catch (_) {
      // the next check tries again; the shop's Wi-Fi keeps working either way
    } finally {
      _maintainingRemote = false;
    }
  }
  Future<void> _forgetRemote() async {
    final had = remoteAddress != null;
    remoteAddress = null; _remoteKey = null; _remoteKeyIssued = null; _remoteJoined = false; viaInternet = false;
    if (had && tailnet.supported) {
      try { await tailnet.stop(forget: true); } catch (_) {}
    }
  }

  bool _checking = false;
  Future<void> checkConnection() async {
    if (mode != AppMode.connected || _checking) return;
    final generation = _generation;
    _checking = true;
    try {
      final data = await _routed((base) => api.me(base, _token!));
      if (generation != _generation) return;
      final user = _readUser(data);
      userName = user['name']?.toString() ?? user['username'].toString();
      role = user['role'].toString(); userId = (user['id'] ?? user['username']).toString(); notice = null;
      await _maintainRemote();
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
    await _forgetRemote();
    try { await storage.clear(); } catch (_) { notice = 'Akses berakhir; penyimpanan perangkat tidak dapat dibersihkan. Coba keluar lagi.'; }
  }
  void startDemo() {
    _generation++; demo = DemoStore(); cart.clear(); billDiscount = 0; _clearBranding();
    mode = AppMode.demo; notice = null; userName = 'Kasir Demo'; notifyListeners();
  }
  Future<void> logout() async {
    _generation++; await _clearCredentials(); _clearBranding();
    mode = AppMode.pairing; cart.clear(); billDiscount = 0; userName = ''; notifyListeners();
  }
  Future<Object?> businessRequest(String path, {required String method,
    Map<String, String>? query, Map<String, dynamic>? body}) async {
    if (mode != AppMode.connected || address == null || _token == null) {
      throw const ApiFailure('Hubungkan perangkat ke PC terlebih dahulu.');
    }
    final generation = _generation;
    try {
      final result = await _routed((base) => api.requestRaw(base: base, path: path, method: method,
        token: _token, query: query, body: body));
      if (generation != _generation) throw const ApiFailure('Sesi perangkat telah berubah.');
      if (!viaInternet && (!hasRemoteAccess || !_remoteJoined)) {
        unawaited(_maintainRemote());
      }
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
      return await _routed((base) => api.transferFile(base: base, path: path, method: method, token: _token, query: query, upload: upload));
    } on ApiFailure catch (e) {
      if (e.unauthorized && generation == _generation) {
        notice = e.message; _generation++;
        await _clearCredentials(); mode = AppMode.pairing; notifyListeners();
      }
      rethrow;
    }
  }
  @override
  void dispose() {
    _joinedSub?.cancel();
    if (tailnet.supported) unawaited(tailnet.stop().catchError((Object _) {}));
    super.dispose();
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
