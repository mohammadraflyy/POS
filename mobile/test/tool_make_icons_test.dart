import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/Widgets/ui.dart';

void main() {
  test('generate modern launcher icons from BrandMarkPainter', () async {
    const targets = {
      'android/app/src/main/res/mipmap-mdpi/ic_launcher.png': 48,
      'android/app/src/main/res/mipmap-hdpi/ic_launcher.png': 72,
      'android/app/src/main/res/mipmap-xhdpi/ic_launcher.png': 96,
      'android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png': 144,
      'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png': 192,
    };

    for (final entry in targets.entries) {
      final size = entry.value.toDouble();
      final recorder = ui.PictureRecorder();
      final canvas = Canvas(recorder, Rect.fromLTWH(0, 0, size, size));

      const painter = BrandMarkPainter(tile: Color(0xFF9B2446), paper: Colors.white, inset: 0.05);
      painter.paint(canvas, Size(size, size));

      final picture = recorder.endRecording();
      final image = await picture.toImage(entry.value, entry.value);
      final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
      expect(byteData, isNotNull);

      final file = File(entry.key);
      if (file.existsSync()) {
        await file.writeAsBytes(byteData!.buffer.asUint8List());
      }
    }
  });
}

