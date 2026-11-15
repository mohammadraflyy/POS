import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../Screen/Live/kasir_style.dart';
import '../state/kasir_keys.dart';
import '../state/window_mode.dart';
import 'popup.dart';

typedef ShortcutRow = (String keys, String action);

/// Every keyboard shortcut, as the code binds it; the Kasir group follows the layout chosen in Pengaturan.
List<(String, List<ShortcutRow>)> shortcutGroups({required bool globalArrows, required bool fullscreen}) => [
  ('Umum', [
    ('Ctrl+↑/↓', 'ganti menu'),
    ('Ctrl+B', 'lipat atau buka sidebar'),
    ('Ctrl+L', 'kunci kasir'),
    ('Ctrl+D', 'mode gelap atau terang'),
    if (fullscreen) ('F11', 'layar penuh'),
    ('Ctrl+/', 'daftar shortcut ini'),
  ]),
  (globalArrows ? 'Kasir, panah global' : 'Kasir', [
    if (globalArrows) ...[
      ('/', 'cari barang'),
      ('PgUp', 'ke Jumlah'),
      ('PgDn', 'ke kotak cari'),
      ('↑↓', 'pindah antara pelanggan, diskon, antrean, keranjang'),
    ] else ...[
      ('/', 'cari barang'),
      ('F1/F2', 'kotak cari'),
      ('PgUp/PgDn', 'pindah panel'),
    ],
    ('F4/F12/End', 'bayar'),
    ('F3', 'ubah baris atas'),
    ('Alt+P', 'pelanggan'),
    ('Alt+T', 'antrean baru'),
    ('Alt+H', 'antrean baru, atau pindah antrean bila keranjang kosong'),
    ('Alt+K', 'kosongkan keranjang'),
    ('Ctrl+P', 'cetak ulang nota terakhir'),
    ('Esc', 'batal ubah nota, saat mengubah nota'),
    ('Enter', 'ubah baris keranjang yang dipilih'),
    ('Delete', 'hapus baris yang dipilih'),
  ]),
  ('Pembayaran', [
    ('Alt+T/B/Q/R', 'tunai, bon, QRIS, transfer'),
    ('Alt+U', 'uang pas'),
    ('Alt+P', 'isi pelanggan'),
    if (globalArrows) ('↑↓ ←→', 'pindah bagian dan pilih'),
    ('End/Alt+S', 'simpan'),
    ('Esc', 'kembali ke kasir'),
    ('C', 'cetak struk setelah disimpan'),
    ('L/Esc', 'lewati cetak'),
  ]),
  ('Riwayat dan nota', [
    ('/', 'cari nota'),
    ('↑↓', 'pilih nota'),
    ('Enter', 'buka nota'),
    ('PgUp/PgDn', 'halaman berikut atau sebelumnya'),
    ('Home/End', 'nota pertama atau terakhir'),
    ('Esc', 'dari nota, kembali'),
    ('P', 'cetak ulang nota'),
    ('E', 'ubah nota'),
    ('S', 'pratinjau struk'),
    ('C', 'salin teks struk'),
  ]),
  ('Modal barang', [
    ('↑↓', 'pindah antara satuan, jumlah, harga, diskon, tombol'),
    ('←→', 'pilih satuan'),
    ('Alt+1..9', 'pilih satuan'),
    ('PgUp/PgDn', 'satuan sebelumnya atau berikutnya'),
    ('Alt+J/H/D', 'lompat ke jumlah, harga, diskon'),
    ('+ / −', 'tambah atau kurangi jumlah'),
    ('Ctrl+Del', 'hapus barang'),
    ('Enter', 'simpan'),
    ('Esc', 'batal'),
  ]),
];

Future<void> showShortcutList(BuildContext context) => showDialog<void>(context: context, builder: (_) => const _ShortcutDialog());

class _ShortcutDialog extends StatelessWidget {
  const _ShortcutDialog();

  Widget _group(String title, List<ShortcutRow> rows) => Padding(
    padding: const EdgeInsets.only(bottom: Space.lg),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Padding(padding: const EdgeInsets.only(bottom: 6), child: Text(title, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: ink))),
      for (final (keys, action) in rows) Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 118, child: Align(alignment: Alignment.centerLeft, child: KasirKey(keys))),
          Expanded(child: Text(action, style: TextStyle(fontSize: 13, height: 1.3, color: secondaryInk))),
        ]),
      ),
    ]),
  );

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([kasirKeys, windowMode]),
    builder: (context, _) {
      final groups = shortcutGroups(globalArrows: kasirKeys.isGlobalArrows, fullscreen: windowMode.supported);
      // Umum and Kasir on the left, the screens that open from the till on the right
      final left = [for (final g in groups.take(2)) _group(g.$1, g.$2)];
      final right = [for (final g in groups.skip(2)) _group(g.$1, g.$2)];
      return Dialog(
        backgroundColor: surface,
        surfaceTintColor: Colors.transparent,
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20), side: BorderSide(color: ruleColor)),
        child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 860, maxHeight: 680), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Padding(padding: const EdgeInsets.fromLTRB(24, 22, 12, 12), child: Row(children: [
            Icon(Icons.keyboard_outlined, color: primaryInk, size: 22),
            const SizedBox(width: 12),
            Expanded(child: Text('Daftar shortcut', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: ink))),
            IconButton(onPressed: () => Navigator.of(context).pop(), tooltip: 'Tutup', visualDensity: VisualDensity.compact,
              icon: Icon(Icons.close_rounded, size: 18, color: muted)),
          ])),
          Divider(height: 1, color: ruleColor),
          Flexible(child: LayoutBuilder(builder: (context, box) => SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 18, 24, 0),
            child: box.maxWidth >= 640
              ? Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: left)),
                  const SizedBox(width: 32),
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: right)),
                ])
              : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [...left, ...right]),
          ))),
          Divider(height: 1, color: ruleColor),
          Padding(padding: const EdgeInsets.all(16), child: Align(alignment: Alignment.centerRight,
            child: PopupButton('Tutup', primary: true, tone: primaryInk, keyHint: 'Esc', autofocus: true, onPressed: () => Navigator.of(context).pop()))),
        ])),
      );
    },
  );
}
