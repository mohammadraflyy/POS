/// Reading uploaded spreadsheets into plain rows, and writing report workbooks.
///
/// `.xlsx` and `.csv` are supported. The legacy binary `.xls` format has no Dart reader,
/// so it is refused with a message telling the owner to re-save the file as `.xlsx`.
library;

import 'dart:convert';

import 'package:excel/excel.dart';

import 'errors.dart';

typedef SheetRows = List<List<Object?>>;

/// The first sheet of an uploaded file, as rows of plain values (num, String, bool, or null).
SheetRows readSheetRows(List<int> bytes, String fileName) {
  final lower = fileName.toLowerCase();

  if (lower.endsWith('.csv')) {
    return parseCsv(utf8.decode(bytes, allowMalformed: true));
  }

  if (lower.endsWith('.xls')) {
    throw BusinessException('Format .xls lama tidak didukung. Simpan ulang file sebagai .xlsx lalu impor lagi.');
  }

  final Excel workbook;

  try {
    workbook = Excel.decodeBytes(bytes);
  } on Object {
    throw BusinessException('File tidak bisa dibaca. Pastikan file berformat .xlsx atau .csv.');
  }

  if (workbook.tables.isEmpty) {
    return [];
  }

  final sheet = workbook.tables.values.first;

  return [
    for (final row in sheet.rows) [for (final cell in row) _plain(cell?.value)],
  ];
}

Object? _plain(CellValue? value) {
  return switch (value) {
    null => null,
    IntCellValue(:final value) => value,
    DoubleCellValue(:final value) => value,
    BoolCellValue(:final value) => value,
    TextCellValue() => value.value.toString(),
    _ => value.toString(),
  };
}

/// RFC 4180-ish CSV: commas or semicolons (whichever the header row uses more of),
/// double-quoted fields with "" escapes, CRLF or LF line ends.
SheetRows parseCsv(String text) {
  final firstLine = text.split('\n').first;
  final separator = ';'.allMatches(firstLine).length > ','.allMatches(firstLine).length ? ';' : ',';
  final rows = <List<Object?>>[];
  var row = <Object?>[];
  final field = StringBuffer();
  var inQuotes = false;

  void endField() {
    final value = field.toString();
    row.add(num.tryParse(value.trim()) ?? value);
    field.clear();
  }

  for (var i = 0; i < text.length; i++) {
    final char = text[i];

    if (inQuotes) {
      if (char == '"') {
        if (i + 1 < text.length && text[i + 1] == '"') {
          field.write('"');
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field.write(char);
      }
    } else if (char == '"') {
      inQuotes = true;
    } else if (char == separator) {
      endField();
    } else if (char == '\n' || char == '\r') {
      if (char == '\r' && i + 1 < text.length && text[i + 1] == '\n') {
        i++;
      }

      endField();
      rows.add(row);
      row = [];
    } else {
      field.write(char);
    }
  }

  if (field.isNotEmpty || row.isNotEmpty) {
    endField();
    rows.add(row);
  }

  return rows;
}

class SheetSpec {
  const SheetSpec({required this.name, required this.headers, required this.rows, this.title});

  final String name;
  final List<String> headers;

  /// Values in header order: num, String, or null.
  final List<List<Object?>> rows;

  /// An optional merged title row above the headers.
  final String? title;
}

/// Builds an `.xlsx` with one sheet per [SheetSpec], columns sized to their content.
List<int> buildWorkbook(List<SheetSpec> sheets) {
  final workbook = Excel.createExcel();
  final defaultSheet = workbook.getDefaultSheet();

  for (final spec in sheets) {
    final name = spec.name.length > 31 ? spec.name.substring(0, 31) : spec.name;
    final sheet = workbook[name];

    if (spec.title != null) {
      sheet.appendRow([TextCellValue(spec.title!)]);

      if (spec.headers.length > 1) {
        sheet.merge(CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: 0), CellIndex.indexByColumnRow(columnIndex: spec.headers.length - 1, rowIndex: 0));
      }
    }

    sheet.appendRow([for (final header in spec.headers) TextCellValue(header)]);

    for (final row in spec.rows) {
      sheet.appendRow([for (final value in row) _cellValue(value)]);
    }

    for (var column = 0; column < spec.headers.length; column++) {
      final longest = spec.rows.fold<int>(spec.headers[column].length, (max, row) {
        final length = column < row.length ? (row[column] ?? '').toString().length : 0;

        return length > max ? length : max;
      });

      sheet.setColumnWidth(column, (longest + 2).clamp(8, 40).toDouble());
    }
  }

  if (defaultSheet != null && !sheets.any((spec) => spec.name == defaultSheet)) {
    workbook.setDefaultSheet(sheets.first.name);
    workbook.delete(defaultSheet);
  }

  return workbook.encode()!;
}

CellValue? _cellValue(Object? value) {
  return switch (value) {
    null => null,
    int() => IntCellValue(value),
    double() => DoubleCellValue(value),
    bool() => BoolCellValue(value),
    _ => TextCellValue(value.toString()),
  };
}
