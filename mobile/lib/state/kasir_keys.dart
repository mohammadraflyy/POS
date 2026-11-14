import 'package:flutter/foundation.dart';
import '../services/draft_store.dart';

/// How the Kasir keyboard moves between Jumlah, the search box and the cart.
enum KasirKeyLayout { current, globalArrows }

/// The Kasir keyboard layout - chosen in Pengaturan, remembered per device.
class KasirKeysController extends ValueNotifier<KasirKeyLayout> {
  KasirKeysController({DraftStore? store}) : _store = store ?? DraftStore.forDevice('keyboard-kasir'), super(KasirKeyLayout.current);
  final DraftStore _store;

  static const labels = {KasirKeyLayout.current: 'Saat ini', KasirKeyLayout.globalArrows: 'Panah global'};
  static const descriptions = {
    KasirKeyLayout.current: 'PgUp/PgDn pindah antara kolom cari dan keranjang; panah kiri/kanan berpindah antara Jumlah dan cari.',
    KasirKeyLayout.globalArrows: 'Seperti app lama: PgUp ke Jumlah, PgDn atau / ke cari; panah bawah ke Pelanggan, Diskon nota, Antrean baru/Kosongkan (kiri/kanan), lalu keranjang. Bayar dengan End.',
  };

  bool get isGlobalArrows => value == KasirKeyLayout.globalArrows;

  Future<void> load() async {
    try {
      final saved = await _store.read();
      value = KasirKeyLayout.values.firstWhere((l) => l.name == saved, orElse: () => KasirKeyLayout.current);
    } catch (_) {
      // first run, or storage unavailable: the current layout
    }
  }

  Future<void> choose(KasirKeyLayout layout) async {
    value = layout;
    try { await _store.write(layout.name); } catch (_) {}
  }
}

/// The one controller for the app.
final kasirKeys = KasirKeysController();
