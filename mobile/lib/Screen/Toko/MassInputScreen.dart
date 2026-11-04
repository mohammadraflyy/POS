import 'package:flutter/material.dart';
import '../../core/theme.dart';
import '../../models/live_models.dart';
import '../../services/store_api.dart';
import '../../Widgets/admin.dart';
import '../../Widgets/ui.dart';

/// One row of the grid, as text the way it is typed.
class _Row {
  _Row({required this.key, this.id, String kode = '', String barcode = '', String nama = '', String kategori = '', String satuan = 'PCS',
      String pokok = '', String jual = '', String stok = '0'})
      : kode = TextEditingController(text: kode), barcode = TextEditingController(text: barcode), nama = TextEditingController(text: nama),
        kategori = TextEditingController(text: kategori), satuan = TextEditingController(text: satuan), pokok = TextEditingController(text: pokok),
        jual = TextEditingController(text: jual), stok = TextEditingController(text: stok);
  final String key;
  final int? id;
  final TextEditingController kode, barcode, nama, kategori, satuan, pokok, jual, stok;
  List<TextEditingController> get all => [kode, barcode, nama, kategori, satuan, pokok, jual, stok];
  bool get blank => id == null && kode.text.trim().isEmpty && nama.text.trim().isEmpty;
  void dispose() { for (final c in all) { c.dispose(); } }

  static String _plain(Object? v) {
    final n = number(v);
    return n == null ? '' : (n == n.roundToDouble() ? n.toInt().toString() : n.toString());
  }

  factory _Row.fromProduct(Map<String, dynamic> p) => _Row(key: 'product-${p['id']}', id: idNumber(p['id']),
    kode: text(p['kodeItem'], ''), barcode: text(p['barcode'], ''), nama: text(p['namaItem'], ''), kategori: text(p['categoryName'], ''),
    satuan: text(p['satuan'], 'PCS'), pokok: _plain(p['hargaPokok']), jual: _plain(p['hargaJual']), stok: _plain(p['stok']));

  Map<String, dynamic> toJson() {
    num money(TextEditingController c) => c.text.trim().isEmpty ? 0 : inputRupiah(c.text);
    return {
      'key': key, 'id': id, 'kodeItem': kode.text.trim(), 'barcode': barcode.text.trim().isEmpty ? null : barcode.text.trim(),
      'namaItem': nama.text.trim(), 'kategori': kategori.text.trim().isEmpty ? null : kategori.text.trim(), 'satuan': satuan.text.trim(),
      'hargaPokok': money(pokok), 'hargaJual': money(jual), 'stok': stok.text.trim().isEmpty ? 0 : inputQty(stok.text, zero: true),
    };
  }
}

/// The desktop's "Input massal": many products typed in one grid and saved together. Opened
/// empty it adds products; opened with [ids] it edits those (stock is changed through
/// Opname there, so its column is locked for existing rows). Either every row is valid and
/// all are saved, or nothing is, and the server's reasons sit under the rows they belong to.
class MassInputScreen extends StatefulWidget {
  const MassInputScreen({super.key, required this.api, this.ids = const []});
  final StoreApi api;
  final List<int> ids;
  @override State<MassInputScreen> createState() => _MassInputScreenState();
}

class _MassInputScreenState extends State<MassInputScreen> {
  final rows = <_Row>[];
  Map<String, Map<String, dynamic>> errors = {};
  bool loading = false, saving = false;
  String? error;
  int _serial = 0;

  static const _columns = [
    ('kodeItem', 'Kode item', 120.0), ('barcode', 'Barcode', 140.0), ('namaItem', 'Nama item', 260.0), ('kategori', 'Kategori', 140.0),
    ('satuan', 'Satuan', 90.0), ('hargaPokok', 'Harga pokok', 120.0), ('hargaJual', 'Harga jual', 120.0), ('stok', 'Stok', 90.0),
  ];

  @override void initState() {
    super.initState();
    if (widget.ids.isEmpty) { rows.addAll([_newRow(), _newRow(), _newRow()]); } else { load(); }
  }
  @override void dispose() { for (final r in rows) { r.dispose(); } super.dispose(); }

  _Row _newRow() => _track(_Row(key: 'baru-${_serial++}'));

  /// The save button counts the filled rows, so typing a code or a name redraws it.
  _Row _track(_Row row) { row.kode.addListener(_changed); row.nama.addListener(_changed); return row; }
  void _changed() { if (mounted) setState(() {}); }

  Future<void> load() async {
    setState(() { loading = true; error = null; });
    try {
      final data = await widget.api.productsByIds(widget.ids);
      if (mounted) setState(() => rows..clear()..addAll(data.map((p) => _track(_Row.fromProduct(p)))));
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => loading = false); }
  }

  Future<void> save() async {
    final filled = rows.where((r) => !r.blank).toList();
    if (filled.isEmpty) { showNotice(context, 'Isi minimal satu baris produk.', kind: NoticeKind.warning); return; }
    setState(() { saving = true; errors = {}; error = null; });
    try {
      final payload = <Map<String, dynamic>>[];
      for (final r in filled) {
        try { payload.add(r.toJson()); }
        catch (_) { throw FormatException('Baris ${rows.indexOf(r) + 1}: harga dan stok harus angka.'); }
      }
      final result = await widget.api.saveProducts(payload);
      if (!mounted) return;
      if (result['success'] != true) {
        setState(() => errors = {for (final e in jsonObject(result['rowErrors']).entries) e.key: jsonObject(e.value)});
        showNotice(context, 'Belum disimpan: ${errors.length} baris perlu diperbaiki. Lihat tanda merah di tabel.', kind: NoticeKind.warning);
        return;
      }
      showNotice(context, '${result['created'] ?? 0} produk baru, ${result['updated'] ?? 0} diubah, ${result['unchanged'] ?? 0} tidak berubah.', kind: NoticeKind.success);
      Navigator.of(context).pop(true);
    } catch (e) { if (mounted) { setState(() => error = e is FormatException ? e.message : e.toString()); showError(context, e); } }
    finally { if (mounted) setState(() => saving = false); }
  }

  Widget _cell(_Row row, int column) {
    final (key, label, width) = _columns[column];
    final controller = row.all[column];
    final locked = key == 'stok' && row.id != null;
    final message = errors[row.key]?[key]?.toString();
    final numeric = key == 'hargaPokok' || key == 'hargaJual' || key == 'stok';
    return SizedBox(width: width, child: Tooltip(message: message ?? '', child: TextField(
      controller: controller, enabled: !saving && !locked, textAlign: numeric ? TextAlign.end : TextAlign.start,
      keyboardType: numeric ? const TextInputType.numberWithOptions(decimal: true) : TextInputType.text,
      textInputAction: TextInputAction.next, style: numeric ? amountStyle.copyWith(fontSize: 14) : const TextStyle(fontSize: 14),
      decoration: InputDecoration(isDense: true, hintText: locked ? 'lewat Opname' : (row.id == null && column == 0 ? label : null),
        contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
        fillColor: message != null ? pillNegativeBg : (locked ? canvas : surface),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(Corners.chip), borderSide: BorderSide(color: message != null ? errorColor : lineColor)),
        disabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(Corners.chip), borderSide: const BorderSide(color: lineColor))),
    )));
  }

  @override Widget build(BuildContext context) {
    final editing = widget.ids.isNotEmpty;
    final messages = [
      for (final (i, r) in rows.indexed) for (final m in (errors[r.key]?.values ?? const <Object?>[])) 'Baris ${i + 1}: $m',
    ];
    return Scaffold(
      appBar: AppBar(title: Text(editing ? 'Ubah massal · ${widget.ids.length} produk' : 'Input massal produk')),
      body: SafeArea(child: loading ? const LinearProgressIndicator(minHeight: 2) : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(padding: const EdgeInsets.fromLTRB(Space.xl, Space.lg, Space.xl, Space.md), child: Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, spacing: Space.md, runSpacing: Space.md, children: [
          Text(editing ? 'Ubah langsung di tabel. Stok produk lama diubah lewat Opname.' : 'Ketik satu produk per baris. Baris yang kosong dilewati.', style: const TextStyle(color: muted)),
          Wrap(spacing: Space.sm, children: [
            if (!editing) OutlinedButton.icon(onPressed: saving ? null : () => setState(() => rows.add(_newRow())), icon: const Icon(Icons.add, size: 18), label: const Text('Tambah baris')),
            FilledButton.icon(onPressed: saving ? null : save, icon: saving ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.check, size: 18),
              label: Text('Simpan ${rows.where((r) => !r.blank).length} baris')),
          ]),
        ])),
        if (error != null) Padding(padding: const EdgeInsets.symmetric(horizontal: Space.xl), child: Text(error!, style: const TextStyle(color: errorColor))),
        if (messages.isNotEmpty) Padding(padding: const EdgeInsets.fromLTRB(Space.xl, 0, Space.xl, Space.md), child: Text(messages.join('\n'), style: const TextStyle(color: errorColor, fontSize: 13))),
        Expanded(child: SingleChildScrollView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: Space.xl),
          child: SizedBox(width: _columns.fold<double>(0, (s, c) => s + c.$3 + 6) + 40 + 40, child: Column(children: [
            Container(height: 34, decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: lineColor))), child: Row(children: [
              const SizedBox(width: 40, child: Text('#', style: TextStyle(color: muted, fontSize: 12))),
              for (final (key, label, width) in _columns) Padding(padding: const EdgeInsets.only(right: 6), child: SizedBox(width: width,
                child: Text(label, textAlign: key == 'hargaPokok' || key == 'hargaJual' || key == 'stok' ? TextAlign.end : TextAlign.start, style: const TextStyle(color: muted, fontSize: 12)))),
            ])),
            Expanded(child: ListView.builder(itemCount: rows.length, itemBuilder: (context, i) => Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Row(children: [
              SizedBox(width: 40, child: Text('${i + 1}', style: amountStyle.copyWith(color: muted, fontSize: 12))),
              for (var c = 0; c < _columns.length; c++) Padding(padding: const EdgeInsets.only(right: 6), child: _cell(rows[i], c)),
              SizedBox(width: 40, child: rows[i].id == null ? IconButton(tooltip: 'Hapus baris ${i + 1}', iconSize: 16, onPressed: saving ? null : () { final removed = rows[i]; setState(() { rows.removeAt(i); if (rows.isEmpty) rows.add(_newRow()); }); WidgetsBinding.instance.addPostFrameCallback((_) => removed.dispose()); },
                style: IconButton.styleFrom(foregroundColor: muted), icon: const Icon(Icons.close)) : null),
            ])))),
          ])))),
      ])),
    );
  }
}
