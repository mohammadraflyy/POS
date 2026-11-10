package com.example.point_of_sales

import android.content.Intent
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {
    // posnet ships as libposnet.so and runs as a program; Dart needs the folder Android
    // installed it to (the only one an app may execute from) and a private folder for
    // the phone's Tailscale identity
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "pos/native").setMethodCallHandler { call, result ->
            when (call.method) {
                "paths" -> result.success(
                    mapOf(
                        "nativeLibraryDir" to applicationInfo.nativeLibraryDir,
                        "filesDir" to filesDir.absolutePath,
                        "cacheDir" to cacheDir.absolutePath,
                    ),
                )
                "installApk" -> {
                    val path = call.argument<String>("path")
                    if (path != null) {
                        try {
                            var file = File(path)
                            val inCache = file.canonicalPath.startsWith(cacheDir.canonicalPath)
                            val inFiles = file.canonicalPath.startsWith(filesDir.canonicalPath)
                            if (!inCache && !inFiles) {
                                val target = File(cacheDir, file.name)
                                file.copyTo(target, overwrite = true)
                                file = target
                            }
                            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
                            val intent = Intent(Intent.ACTION_VIEW).apply {
                                setDataAndType(uri, "application/vnd.android.package-archive")
                                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            }
                            startActivity(intent)
                            result.success(true)
                        } catch (e: Exception) {
                            result.error("INSTALL_ERROR", e.localizedMessage, null)
                        }
                    } else {
                        result.error("INVALID_PATH", "Path is null", null)
                    }
                }
                else -> result.notImplemented()
            }
        }
    }
}
