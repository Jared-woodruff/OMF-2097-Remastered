//! Desktop shell for One Must Fall 2097 Remastered: WebView2 windows hosting the Vite-built web
//! game (index.html) and OMF Studio, the modding tool (studio.html). The program opens the game,
//! or Studio when it is started with `--studio` or its file is named like `omf-studio.exe` (the
//! release's Studio download is this program under that name). The game opens Studio in a second
//! window (`open_studio`); both share the game's storage, so Studio installs mods straight into it.
//! Permissions are in `capabilities/default.json`; the frontend talks to Tauri through
//! `src/platform/desktop.ts`.

use std::time::Duration;

use tauri::{webview::PageLoadEvent, Manager, WebviewUrl, WebviewWindowBuilder};

/// Show a window after this long even if the page never reports that it finished loading.
const SHOW_WINDOW_FALLBACK: Duration = Duration::from_secs(5);

/// WebView2's arguments: the same for every window (windows that share the storage must agree on them).
const BROWSER_ARGS: &str =
  "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

/// Whether this start opens OMF Studio instead of the game.
fn studio_start() -> bool {
  let flag = std::env::args().skip(1).any(|a| a.eq_ignore_ascii_case("--studio"));
  let named = std::env::current_exe()
    .ok()
    .and_then(|p| p.file_stem().map(|s| s.to_string_lossy().to_lowercase()))
    .is_some_and(|name| name.contains("studio"));
  flag || named
}

/// Opens a window: the game ("main", index.html) or OMF Studio ("studio", studio.html). Created hidden and
/// shown once its page has loaded, so there is no white flash while WebView2 starts up.
fn open_window(app: &tauri::AppHandle, studio: bool) -> tauri::Result<tauri::WebviewWindow> {
  let (label, page, title, size) = if studio {
    ("studio", "studio.html", "OMF Studio", (1440.0, 900.0))
  } else {
    ("main", "index.html", "One Must Fall 2097 Remastered", (1280.0, 800.0))
  };
  if let Some(window) = app.get_webview_window(label) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    return Ok(window);
  }
  let window = WebviewWindowBuilder::new(app, label, WebviewUrl::App(page.into()))
    .title(title)
    .inner_size(size.0, size.1)
    .min_inner_size(640.0, 400.0)
    .resizable(true)
    .center()
    .prevent_overflow()
    .visible(false)
    .background_color(tauri::webview::Color(if studio { 4 } else { 0 }, if studio { 6 } else { 0 }, if studio { 26 } else { 0 }, 255))
    // (files dropped on the window reach the page: mods, music, pictures)
    .disable_drag_drop_handler()
    .additional_browser_args(BROWSER_ARGS)
    .build()?;
  let handle = app.clone();
  let label = label.to_string();
  std::thread::spawn(move || {
    std::thread::sleep(SHOW_WINDOW_FALLBACK);
    if let Some(window) = handle.get_webview_window(&label) {
      let _ = window.show();
    }
  });
  #[cfg(windows)]
  if !cfg!(debug_assertions) {
    disable_browser_ui(&window);
  }
  Ok(window)
}

/// Opens OMF Studio's window (or brings it to the front). Async: on Windows, building a window from a synchronous
/// command deadlocks (it runs on the main thread the window needs).
#[tauri::command]
async fn open_studio(app: tauri::AppHandle) -> Result<(), String> {
  open_window(&app, true).map(|_| ()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Windows are created hidden (open_window) and shown once their page has loaded.
    .on_page_load(|webview, payload| {
      if payload.event() == PageLoadEvent::Finished {
        let _ = webview.window().show();
      }
    })
    .setup(|app| {
      open_window(app.handle(), studio_start())?;
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![save_file, open_studio])
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
