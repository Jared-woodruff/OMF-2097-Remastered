//! Desktop shell for One Must Fall 2097 Remastered: one WebView2 window hosting the Vite-built
//! web game. Window, WebView2 arguments and permissions are configured in `tauri.conf.json` and
//! `capabilities/default.json`; the frontend talks to Tauri through `src/platform/desktop.ts`.

use std::time::Duration;

use tauri::{webview::PageLoadEvent, Manager};

/// Show the main window after this long even if the page never reports that it finished loading.
const SHOW_WINDOW_FALLBACK: Duration = Duration::from_secs(5);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // The main window is created hidden (see tauri.conf.json) and shown once the page has loaded,
    // so there is no white flash while WebView2 starts up.
    .on_page_load(|webview, payload| {
      if payload.event() == PageLoadEvent::Finished {
        let _ = webview.window().show();
      }
    })
    .setup(|app| {
      let handle = app.handle().clone();
      std::thread::spawn(move || {
        std::thread::sleep(SHOW_WINDOW_FALLBACK);
        if let Some(window) = handle.get_webview_window("main") {
          let _ = window.show();
        }
      });

      #[cfg(windows)]
      if !cfg!(debug_assertions) {
        if let Some(window) = app.get_webview_window("main") {
          disable_browser_ui(&window);
        }
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![save_file])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

/// Saves a file the game hands over (a replay, a video or GIF clip) in Downloads\OMF 2097
/// Remastered, adding a number when the name is taken. The request body is the file's bytes and
/// the `x-file-name` header its name (see `saveFile` in src/platform/files.ts). Returns the path.
#[tauri::command]
fn save_file(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
  let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
    return Err("expected the file's bytes".into());
  };
  let name = request
    .headers()
    .get("x-file-name")
    .and_then(|v| v.to_str().ok())
    .map(safe_file_name)
    .filter(|n| !n.is_empty())
    .ok_or("missing file name")?;
  let dir = app.path().download_dir().map_err(|e| e.to_string())?.join("OMF 2097 Remastered");
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let path = free_path(&dir, &name);
  std::fs::write(&path, data).map_err(|e| e.to_string())?;
  Ok(path.to_string_lossy().into_owned())
}

/// Letters, digits, spaces, dots, dashes and underscores only (no paths), not starting with a dot.
fn safe_file_name(name: &str) -> String {
  let name: String = name
    .chars()
    .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ' '))
    .collect();
  name.trim_start_matches('.').trim().to_string()
}

/// `dir/name`, or `dir/name (2)`, `dir/name (3)`... when it exists.
fn free_path(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
  let path = dir.join(name);
  if !path.exists() {
    return path;
  }
  let (stem, ext) = match name.rfind('.') {
    Some(i) if i > 0 => (&name[..i], &name[i..]),
    _ => (name, ""),
  };
  (2..)
    .map(|n| dir.join(format!("{stem} ({n}){ext}")))
    .find(|p| !p.exists())
    .expect("a free file name")
}

/// Release builds: stop WebView2 from acting on browser shortcuts (F5/Ctrl+R reload, Ctrl+F/F3
/// find, Ctrl+P print, ...) and from showing its default context menu, so a keyboard-driven game
/// can't trigger them by accident. The page still receives every key and `contextmenu` event.
/// Dev builds keep both so DevTools stay reachable.
///
/// Tauri has no config switch for this, and the equivalent WebView2 *settings*
/// (AreBrowserAcceleratorKeysEnabled etc.) only apply from the next navigation, which is too late
/// for the game's single page load. The per-event hooks used here apply immediately.
/// `webview2-com`/`windows-core` in Cargo.toml must stay on the versions Tauri itself uses.
#[cfg(windows)]
fn disable_browser_ui(window: &tauri::WebviewWindow) {
  use webview2_com::{
    AcceleratorKeyPressedEventHandler, ContextMenuRequestedEventHandler,
    Microsoft::Web::WebView2::Win32::{ICoreWebView2AcceleratorKeyPressedEventArgs2, ICoreWebView2_11},
  };
  use windows_core::Interface;

  let _ = window.with_webview(|webview| unsafe {
    let controller = webview.controller();
    let mut token = 0;
    let _ = controller.add_AcceleratorKeyPressed(
      &AcceleratorKeyPressedEventHandler::create(Box::new(|_, args| {
        if let Some(args) = args.and_then(|args| args.cast::<ICoreWebView2AcceleratorKeyPressedEventArgs2>().ok()) {
          args.SetIsBrowserAcceleratorKeyEnabled(false)?;
        }
        Ok(())
      })),
      &mut token,
    );
    if let Ok(core) = controller.CoreWebView2().and_then(|core| core.cast::<ICoreWebView2_11>()) {
      let _ = core.add_ContextMenuRequested(
        &ContextMenuRequestedEventHandler::create(Box::new(|_, args| {
          if let Some(args) = args {
            args.SetHandled(true)?;
          }
          Ok(())
        })),
        &mut token,
      );
    }
  });
}
