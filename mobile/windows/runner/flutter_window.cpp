#include "flutter_window.h"

#include <dwmapi.h>
#include <flutter/standard_method_codec.h>

#include <optional>

#include "flutter/generated_plugin_registrant.h"

FlutterWindow::FlutterWindow(const flutter::DartProject& project)
    : project_(project) {}

FlutterWindow::~FlutterWindow() {}

bool FlutterWindow::OnCreate() {
  if (!Win32Window::OnCreate()) {
    return false;
  }

  RECT frame = GetClientArea();

  // The size here must match the window dimensions to avoid unnecessary surface
  // creation / destruction in the startup path.
  flutter_controller_ = std::make_unique<flutter::FlutterViewController>(
      frame.right - frame.left, frame.bottom - frame.top, project_);
  // Ensure that basic setup of the controller was successful.
  if (!flutter_controller_->engine() || !flutter_controller_->view()) {
    return false;
  }
  RegisterPlugins(flutter_controller_->engine());
  SetChildContent(flutter_controller_->view()->GetNativeWindow());

  // "caption" {background, text: 0xAARRGGBB, dark: bool} paints the title bar like the
  // app header, so the two read as one strip (Windows 11; older Windows ignores it).
  window_channel_ = std::make_unique<flutter::MethodChannel<flutter::EncodableValue>>(
      flutter_controller_->engine()->messenger(), "pos/window",
      &flutter::StandardMethodCodec::GetInstance());
  window_channel_->SetMethodCallHandler([this](const auto& call, auto result) {
    if (call.method_name() == "fullscreen") {
      const auto* on = std::get_if<bool>(call.arguments());
      if (on == nullptr) {
        result->Error("bad-args", "fullscreen takes a bool");
        return;
      }
      SetFullscreen(*on);
      result->Success(flutter::EncodableValue(fullscreen_));
      return;
    }
    if (call.method_name() == "isFullscreen") {
      result->Success(flutter::EncodableValue(fullscreen_));
      return;
    }
    const auto* args = std::get_if<flutter::EncodableMap>(call.arguments());
    if (call.method_name() != "caption" || args == nullptr) {
      result->NotImplemented();
      return;
    }
    auto argb = [args](const char* key) {
      auto it = args->find(flutter::EncodableValue(key));
      return it == args->end() ? 0LL : it->second.LongValue();
    };
    auto colorref = [](long long argb) {
      return static_cast<COLORREF>(RGB((argb >> 16) & 0xFF, (argb >> 8) & 0xFF, argb & 0xFF));
    };
    auto dark_it = args->find(flutter::EncodableValue("dark"));
    BOOL dark = dark_it != args->end() && std::get<bool>(dark_it->second);
    COLORREF caption = colorref(argb("background"));
    COLORREF text = colorref(argb("text"));
    HWND hwnd = GetHandle();
    DwmSetWindowAttribute(hwnd, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, &dark, sizeof(dark));
    DwmSetWindowAttribute(hwnd, 34 /* DWMWA_BORDER_COLOR */, &caption, sizeof(caption));
    DwmSetWindowAttribute(hwnd, 35 /* DWMWA_CAPTION_COLOR */, &caption, sizeof(caption));
    DwmSetWindowAttribute(hwnd, 36 /* DWMWA_TEXT_COLOR */, &text, sizeof(text));
    app_caption_ = true;
    result->Success();
  });

  flutter_controller_->engine()->SetNextFrameCallback([&]() {
    this->Show();
    // asked for before the window was on screen: now there is a placement to come back to
    if (fullscreen_) {
      fullscreen_ = false;
      SetFullscreen(true);
    }
  });

  // Flutter can complete the first frame before the "show window" callback is
  // registered. The following call ensures a frame is pending to ensure the
  // window is shown. It is a no-op if the first frame hasn't completed yet.
  flutter_controller_->ForceRedraw();

  return true;
}

// Borderless over the whole monitor (taskbar included); leaving puts the old style and
// placement back, so a maximized window returns maximized.
void FlutterWindow::SetFullscreen(bool on) {
  HWND hwnd = GetHandle();
  if (!IsWindowVisible(hwnd)) {
    fullscreen_ = on;
    return;
  }
  if (on == fullscreen_) return;
  if (on) {
    saved_style_ = GetWindowLong(hwnd, GWL_STYLE);
    saved_placement_.length = sizeof(saved_placement_);
    GetWindowPlacement(hwnd, &saved_placement_);
    MONITORINFO monitor = {sizeof(monitor)};
    GetMonitorInfo(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), &monitor);
    SetWindowLong(hwnd, GWL_STYLE, saved_style_ & ~WS_OVERLAPPEDWINDOW);
    SetWindowPos(hwnd, HWND_TOP, monitor.rcMonitor.left, monitor.rcMonitor.top,
                 monitor.rcMonitor.right - monitor.rcMonitor.left,
                 monitor.rcMonitor.bottom - monitor.rcMonitor.top,
                 SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
  } else {
    SetWindowLong(hwnd, GWL_STYLE, saved_style_);
    SetWindowPlacement(hwnd, &saved_placement_);
    SetWindowPos(hwnd, nullptr, 0, 0, 0, 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
  }
  fullscreen_ = on;
}

void FlutterWindow::OnDestroy() {
  if (flutter_controller_) {
    flutter_controller_ = nullptr;
  }

  Win32Window::OnDestroy();
}

LRESULT
FlutterWindow::MessageHandler(HWND hwnd, UINT const message,
                              WPARAM const wparam,
                              LPARAM const lparam) noexcept {
  // Give Flutter, including plugins, an opportunity to handle window messages.
  if (flutter_controller_) {
    std::optional<LRESULT> result =
        flutter_controller_->HandleTopLevelWindowProc(hwnd, message, wparam,
                                                      lparam);
    if (result) {
      return *result;
    }
  }

  switch (message) {
    case WM_FONTCHANGE:
      flutter_controller_->engine()->ReloadSystemFonts();
      break;
    case WM_DWMCOLORIZATIONCOLORCHANGED:
      // the app picks light or dark itself; keep its title bar, not the system's
      if (app_caption_) return 0;
      break;
  }

  return Win32Window::MessageHandler(hwnd, message, wparam, lparam);
}
