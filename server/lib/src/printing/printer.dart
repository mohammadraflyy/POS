import 'dart:ffi';
import 'dart:io';
import 'dart:isolate';

import 'package:ffi/ffi.dart';

import '../core/errors.dart';

class PrinterInfo {
  const PrinterInfo({required this.name, required this.isDefault});

  final String name;
  final bool isDefault;

  Map<String, Object?> toJson() => {'name': name, 'displayName': name, 'isDefault': isDefault};
}

/// Where raw ESC/POS bytes go. The real one talks to the Windows spooler; tests and
/// non-Windows hosts use [NoPrinter] or their own fake.
abstract class RawPrinter {
  Future<List<PrinterInfo>> listPrinters();

  /// Sends [bytes] to [printerName], or to the OS default printer when it is null.
  Future<void> printRaw(String? printerName, List<int> bytes);
}

class NoPrinter implements RawPrinter {
  const NoPrinter();

  @override
  Future<List<PrinterInfo>> listPrinters() async => [];

  @override
  Future<void> printRaw(String? printerName, List<int> bytes) async {
    throw BusinessException('Cetak tidak tersedia di server ini.');
  }
}

RawPrinter defaultRawPrinter() => Platform.isWindows ? WindowsSpoolerPrinter() : const NoPrinter();

/// Raw output straight to the Windows spooler through winspool.drv, the same calls the
/// desktop app makes. Every call runs on a short-lived isolate, so a spooler that never
/// answers cannot freeze the HTTP server, and jobs are queued one at a time.
class WindowsSpoolerPrinter implements RawPrinter {
  WindowsSpoolerPrinter({this.timeout = const Duration(seconds: 30)});

  final Duration timeout;
  Future<void> _queue = Future.value();

  @override
  Future<List<PrinterInfo>> listPrinters() => Isolate.run(_enumPrinters);

  @override
  Future<void> printRaw(String? printerName, List<int> bytes) {
    Future<void> run() async {
      try {
        final name = printerName ?? await Isolate.run(_defaultPrinterName);

        if (name == null) {
          throw BusinessException('Tidak ada printer default. Pilih printer di Pengaturan.');
        }

        final data = List<int>.of(bytes);
        await _sendOnIsolate(name, data).timeout(
          timeout,
          onTimeout: () => throw BusinessException('printer tidak merespons dalam ${timeout.inSeconds} detik'),
        );
      } on BusinessException catch (error) {
        throw BusinessException(error.message.startsWith('Gagal mencetak') || error.message.startsWith('Tidak ada printer')
            ? error.message
            : 'Gagal mencetak: ${error.message}');
      } on Object catch (error) {
        throw BusinessException('Gagal mencetak: $error');
      }
    }

    // one receipt at a time: two prints really can overlap
    final next = _queue.then((_) => run(), onError: (_) => run());
    _queue = next.then((_) {}, onError: (_) {});

    return next;
  }
}

/// Top-level on purpose: a closure made inside a method would capture the printer object
/// (and its queue of futures), which cannot be sent to another isolate.
Future<void> _sendOnIsolate(String printerName, List<int> data) => Isolate.run(() => _sendToPrinter(printerName, data));

// --- winspool.drv bindings ---------------------------------------------------

final class _DocInfo1 extends Struct {
  external Pointer<Utf16> pDocName;
  external Pointer<Utf16> pOutputFile;
  external Pointer<Utf16> pDatatype;
}

final class _PrinterInfo4 extends Struct {
  external Pointer<Utf16> pPrinterName;
  external Pointer<Utf16> pServerName;

  @Uint32()
  external int attributes;
}

typedef _OpenPrinterNative = Int32 Function(Pointer<Utf16>, Pointer<IntPtr>, Pointer<Void>);
typedef _OpenPrinterDart = int Function(Pointer<Utf16>, Pointer<IntPtr>, Pointer<Void>);
typedef _HandleNative = Int32 Function(IntPtr);
typedef _HandleDart = int Function(int);
typedef _StartDocNative = Uint32 Function(IntPtr, Uint32, Pointer<_DocInfo1>);
typedef _StartDocDart = int Function(int, int, Pointer<_DocInfo1>);
typedef _WritePrinterNative = Int32 Function(IntPtr, Pointer<Uint8>, Uint32, Pointer<Uint32>);
typedef _WritePrinterDart = int Function(int, Pointer<Uint8>, int, Pointer<Uint32>);
typedef _GetDefaultPrinterNative = Int32 Function(Pointer<Utf16>, Pointer<Uint32>);
typedef _GetDefaultPrinterDart = int Function(Pointer<Utf16>, Pointer<Uint32>);
typedef _EnumPrintersNative = Int32 Function(Uint32, Pointer<Utf16>, Uint32, Pointer<Uint8>, Uint32, Pointer<Uint32>, Pointer<Uint32>);
typedef _EnumPrintersDart = int Function(int, Pointer<Utf16>, int, Pointer<Uint8>, int, Pointer<Uint32>, Pointer<Uint32>);

const _printerEnumLocal = 0x2;
const _printerEnumConnections = 0x4;

void _sendToPrinter(String printerName, List<int> data) {
  final winspool = DynamicLibrary.open('winspool.drv');
  final openPrinter = winspool.lookupFunction<_OpenPrinterNative, _OpenPrinterDart>('OpenPrinterW');
  final closePrinter = winspool.lookupFunction<_HandleNative, _HandleDart>('ClosePrinter');
  final startDoc = winspool.lookupFunction<_StartDocNative, _StartDocDart>('StartDocPrinterW');
  final endDoc = winspool.lookupFunction<_HandleNative, _HandleDart>('EndDocPrinter');
  final startPage = winspool.lookupFunction<_HandleNative, _HandleDart>('StartPagePrinter');
  final endPage = winspool.lookupFunction<_HandleNative, _HandleDart>('EndPagePrinter');
  final writePrinter = winspool.lookupFunction<_WritePrinterNative, _WritePrinterDart>('WritePrinter');

  using((arena) {
    final handleOut = arena<IntPtr>();

    if (openPrinter(printerName.toNativeUtf16(allocator: arena), handleOut, nullptr) == 0) {
      throw BusinessException('printer "$printerName" tidak bisa dibuka');
    }

    final handle = handleOut.value;

    try {
      final docInfo = arena<_DocInfo1>()
        ..ref.pDocName = 'POS Receipt'.toNativeUtf16(allocator: arena)
        ..ref.pOutputFile = nullptr
        ..ref.pDatatype = 'RAW'.toNativeUtf16(allocator: arena);

      if (startDoc(handle, 1, docInfo) == 0) {
        throw BusinessException('spooler menolak dokumen baru');
      }

      try {
        if (startPage(handle) == 0) {
          throw BusinessException('spooler menolak halaman baru');
        }

        try {
          final buffer = arena<Uint8>(data.length);
          buffer.asTypedList(data.length).setAll(0, data);

          if (writePrinter(handle, buffer, data.length, arena<Uint32>()) == 0) {
            throw BusinessException('data gagal dikirim ke printer');
          }
        } finally {
          endPage(handle);
        }
      } finally {
        endDoc(handle);
      }
    } finally {
      closePrinter(handle);
    }
  });
}

String? _defaultPrinterName() {
  final winspool = DynamicLibrary.open('winspool.drv');
  final getDefault = winspool.lookupFunction<_GetDefaultPrinterNative, _GetDefaultPrinterDart>('GetDefaultPrinterW');

  return using((arena) {
    final size = arena<Uint32>()..value = 512;
    final buffer = arena<Uint16>(512).cast<Utf16>();

    return getDefault(buffer, size) == 0 ? null : buffer.toDartString();
  });
}

List<PrinterInfo> _enumPrinters() {
  final winspool = DynamicLibrary.open('winspool.drv');
  final enumPrinters = winspool.lookupFunction<_EnumPrintersNative, _EnumPrintersDart>('EnumPrintersW');
  final defaultName = _defaultPrinterName();

  return using((arena) {
    const flags = _printerEnumLocal | _printerEnumConnections;
    final needed = arena<Uint32>();
    final returned = arena<Uint32>();

    enumPrinters(flags, nullptr, 4, nullptr, 0, needed, returned);

    if (needed.value == 0) {
      return <PrinterInfo>[];
    }

    final buffer = arena<Uint8>(needed.value);

    if (enumPrinters(flags, nullptr, 4, buffer, needed.value, needed, returned) == 0) {
      return <PrinterInfo>[];
    }

    final infos = buffer.cast<_PrinterInfo4>();

    return [
      for (var i = 0; i < returned.value; i++)
        () {
          final name = infos[i].pPrinterName.toDartString();

          return PrinterInfo(name: name, isDefault: name == defaultName);
        }(),
    ];
  });
}
