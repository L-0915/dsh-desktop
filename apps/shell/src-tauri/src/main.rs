//! dsh-desktop shell — standalone desktop window for the DeepSeek Harness
//! Web GUI.
//!
//! Startup flow:
//!   1. Load `desktop-launcher.json` (looked up under `$DSH_HOME`, then next
//!      to the executable) for the target URL, port, optional start command,
//!      and the icon path applied to the desktop shortcut.
//!   2. Probe the port; when the web service is not running and a start
//!      command is configured, spawn it in the background (hidden window on
//!      Windows, output captured to a log file under `$DSH_HOME/logs`) and
//!      poll until the port accepts connections.
//!   3. Load the URL in the webview, replacing the local loading page.
//!
//! The plugin writes the config with camelCase JSON keys (`startCommand`,
//! `startCwd`, `timeoutSecs`, `iconPath`), hence `#[serde(rename_all =
//! "camelCase")]` on the config struct — without it every optional field
//! silently resolves to its default and the shell never starts the service.
//!
//! When the service does not become ready in time (or the start command
//! fails), the loading page switches to an error state with a retry button
//! instead of hanging forever; retry re-runs the same start-and-poll flow
//! through the `retry_start` command.
//!
//! The window icon is set at startup from the configured icon path (the same
//! file the desktop shortcut points at), so the window icon always matches
//! the desktop icon the user chose — without recompiling.
//!
//! GUI subsystem (Windows): release builds must NOT attach a console window —
//! this is what makes the shortcut open straight into the app window.

// Windows GUI subsystem: no console window in release builds. In debug builds
// the console stays so cargo's output remains visible.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, Manager, WebviewWindow};

/// Runtime configuration read from `desktop-launcher.json`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LauncherConfig {
    /// Target URL of the DSH web GUI.
    #[serde(default = "default_url")]
    url: String,
    /// Port probed to decide whether the service is up.
    #[serde(default = "default_port")]
    port: u16,
    /// Optional command to start the web service (program + args).
    #[serde(default)]
    start_command: Option<Vec<String>>,
    /// Working directory for the start command.
    #[serde(default)]
    start_cwd: Option<String>,
    /// Seconds to keep polling for the port before giving up.
    #[serde(default = "default_timeout_secs")]
    timeout_secs: u64,
    /// Absolute path of the icon applied to the desktop shortcut. The window
    /// icon is set from this file at startup so it matches the desktop icon.
    #[serde(default)]
    icon_path: Option<String>,
}

fn default_url() -> String {
    "http://127.0.0.1:3080".to_string()
}

fn default_port() -> u16 {
    3080
}

fn default_timeout_secs() -> u64 {
    60
}

impl Default for LauncherConfig {
    fn default() -> Self {
        Self {
            url: default_url(),
            port: default_port(),
            start_command: None,
            start_cwd: None,
            timeout_secs: default_timeout_secs(),
            icon_path: None,
        }
    }
}

/// Candidate config paths, most specific first.
fn config_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(home) = std::env::var("DSH_HOME") {
        candidates.push(PathBuf::from(home).join("desktop-launcher.json"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("desktop-launcher.json"));
        }
    }
    candidates
}

fn load_config() -> LauncherConfig {
    for path in config_candidates() {
        if let Ok(text) = std::fs::read_to_string(&path) {
            match serde_json::from_str::<LauncherConfig>(&text) {
                Ok(config) => {
                    eprintln!("[dsh-desktop] loaded config from {}", path.display());
                    return config;
                }
                Err(error) => {
                    eprintln!("[dsh-desktop] ignoring invalid config {}: {error}", path.display());
                }
            }
        }
    }
    eprintln!("[dsh-desktop] no config found, using defaults");
    LauncherConfig::default()
}

/// Whether the service port accepts connections.
fn port_open(port: u16) -> bool {
    TcpStream::connect(("127.0.0.1", port)).is_ok()
}

/// Log file receiving the spawned service's stdout/stderr, so a service that
/// fails after launch leaves a trace. Lives at `$DSH_HOME/logs/…` (next to
/// the executable when DSH_HOME is unset).
fn service_log_path() -> PathBuf {
    let base = std::env::var("DSH_HOME")
        .map(PathBuf::from)
        .ok()
        .or_else(|| std::env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf)))
        .unwrap_or_default();
    base.join("logs").join("dsh-desktop-service.log")
}

/// Open (creating, and truncating beyond 1 MiB) the service log for appends.
fn open_service_log() -> std::io::Result<File> {
    let path = service_log_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > 1024 * 1024 {
            let _ = OpenOptions::new().write(true).truncate(true).open(&path);
        }
    }
    OpenOptions::new().create(true).append(true).open(path)
}

/// Spawn the configured start command detached from this process, capturing
/// its output into the service log. A missing/empty command is an error —
/// there is then nothing that can bring the service up.
/// @returns the spawned service's PID, so the shell can stop it on exit.
fn spawn_start_command(config: &LauncherConfig) -> Result<u32, String> {
    let command = config
        .start_command
        .as_deref()
        .filter(|parts| !parts.is_empty())
        .ok_or_else(|| "startCommand is empty in desktop-launcher.json".to_string())?;
    let program = &command[0];
    let args = &command[1..];
    let mut child = Command::new(program);
    child.args(args);
    if let Some(cwd) = config.start_cwd.as_deref().filter(|cwd| !cwd.is_empty()) {
        child.current_dir(cwd);
    }
    let log_file = match open_service_log() {
        Ok(file) => Some(file),
        Err(error) => {
            eprintln!("[dsh-desktop] service log unavailable: {error}");
            None
        }
    };
    if let Some(log_file) = log_file {
        let mut log_writer = log_file.try_clone().map_err(|error| error.to_string())?;
        let _ = writeln!(log_writer, "--- starting {} {} ---", program, args.join(" "));
        child.stdout(Stdio::from(log_file.try_clone().map_err(|error| error.to_string())?));
        child.stderr(Stdio::from(log_file));
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: keep the spawned service off the taskbar.
        child.creation_flags(0x0800_0000);
    }
    let spawned = child
        .spawn()
        .map_err(|error| format!("failed to start {program}: {error}"))?;
    Ok(spawned.id())
}

/// Poll the port until open or the timeout elapses.
fn wait_for_port(port: u16, timeout: Duration, cancelled: &AtomicBool) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if cancelled.load(Ordering::Relaxed) {
            return false;
        }
        if port_open(port) {
            return true;
        }
        thread::sleep(Duration::from_millis(500));
    }
    port_open(port)
}

/// Navigate the window to the configured GUI URL.
fn open_gui(window: &WebviewWindow, url: &str) {
    eprintln!("[dsh-desktop] service up, loading {url}");
    match url.parse::<url::Url>() {
        Ok(parsed) => {
            let _ = window.navigate(parsed);
        }
        Err(error) => eprintln!("[dsh-desktop] invalid URL: {error}"),
    }
}

/// Switch the loading page to its error state (message + retry button).
fn show_error(window: &WebviewWindow, message: &str) {
    eprintln!("[dsh-desktop] startup failed: {message}");
    let encoded = serde_json::to_string(message)
        .unwrap_or_else(|_| "\"service failed to start\"".to_string());
    let _ = window.eval(&format!("window.__dshShowError && window.__dshShowError({encoded})"));
}

/// One start-and-poll attempt; when it fails the loading page shows the error
/// state (the retry button runs `retry_start`, which calls this again).
fn try_start(
    app: &AppHandle,
    window: &WebviewWindow,
    config: &LauncherConfig,
    cancelled: &AtomicBool,
    service_pid: &Mutex<Option<u32>>,
) {
    if port_open(config.port) {
        open_gui(window, &config.url);
        return;
    }
    let pid = match spawn_start_command(config) {
        Ok(pid) => pid,
        Err(error) => {
            show_error(window, &error);
            return;
        }
    };
    // Remember the spawned service PID so "退出" can stop it along with the window.
    if let Ok(mut guard) = service_pid.lock() {
        *guard = Some(pid);
    }
    let timeout = Duration::from_secs(config.timeout_secs);
    if wait_for_port(config.port, timeout, cancelled) {
        open_gui(window, &config.url);
    } else {
        let log = service_log_path();
        show_error(
            window,
            &format!(
                "服务在 {} 秒内没有就绪。\n请点击下方「重试」按钮；服务日志：{}",
                timeout.as_secs(),
                log.display()
            ),
        );
    }
}

/// Shared state for the retry and exit commands.
struct AppState {
    config: LauncherConfig,
    cancelled: Arc<AtomicBool>,
    /// PID of the service this shell spawned, when any. "退出" stops it.
    service_pid: Arc<Mutex<Option<u32>>>,
}

/// Retry the service start from the loading page's retry button.
#[tauri::command]
fn retry_start(app: AppHandle) {
    let state = app.state::<AppState>();
    let window = app
        .get_webview_window("main")
        .expect("main window must exist");
    let _ = window.eval("window.__dshShowLoading && window.__dshShowLoading()");
    let config = state.config.clone();
    let cancelled = state.cancelled.clone();
    let service_pid = state.service_pid.clone();
    let app_handle = app.clone();
    thread::spawn(move || try_start(&app_handle, &window, &config, &cancelled, &service_pid));
}

/// Stop the spawned service (if any) and close the window — the "一起走" choice.
#[tauri::command]
fn exit_app(app: AppHandle) {
    let state = app.state::<AppState>();
    stop_service(&state, state.config.port);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.close();
    }
    app.exit(0);
}

/// Close the window only, leaving the service running — the "留下小鲸鱼" choice.
/// Takes the PID first so the CloseRequested interceptor sees no spawned
/// service and lets the close proceed without asking again.
#[tauri::command]
fn close_window(app: AppHandle) {
    let state = app.state::<AppState>();
    if let Ok(mut guard) = state.service_pid.lock() {
        let _ = guard.take(); // keep the service; just forget we spawned it
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.close();
    }
}

/// Kill the service on the given port (and any service this shell spawned).
/// On Windows this finds the process LISTENING on the port via netstat, so
/// "一起走" stops the service no matter who started it.
fn stop_service(state: &AppState, port: u16) {
    // The service we spawned ourselves, if any.
    if let Ok(mut guard) = state.service_pid.lock() {
        if let Some(pid) = guard.take() {
            kill_pid(pid);
        }
    }
    // Also stop whatever is listening on the port (user-started service).
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let script = format!(
            "$c = Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue; \
             if ($c) {{ $c | ForEach-Object {{ Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }} }}",
        );
        let _ = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(0x0800_0000)
            .spawn();
    }
}

/// Kill one process tree (Windows: taskkill /T /F).
fn kill_pid(pid: u32) {
    eprintln!("[dsh-desktop] stopping PID {pid}");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(0x0800_0000)
            .spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").arg(pid.to_string()).spawn();
    }
}

/// Inject a skin-aware, stylized exit dialog into the CURRENT page (the DSH
/// GUI after navigation). Uses the page's `--dsw-alias-*` skin tokens so it
/// matches the active theme; buttons call the Tauri commands directly
/// (withGlobalTauri is enabled, so `window.__TAURI__` exists on any page).
fn ask_exit_via_page(window: &WebviewWindow) {
    let script = r#"
(() => {
  if (document.getElementById('dsh-exit-dialog')) return;
  const d = document.createElement('div');
  d.id = 'dsh-exit-dialog';
  d.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
    'z-index:2147483647',
    'display:flex', 'align-items:center', 'justify-content:center',
    'background:rgba(0,0,0,.45)', 'backdrop-filter:blur(4px)',
    'font-family:system-ui,-apple-system,"Segoe UI",sans-serif',
  ].join(';');
  d.innerHTML = `
    <div style="
      width:min(380px,86vw); border-radius:16px; overflow:hidden;
      background:var(--dsw-alias-bg-layer-2,#111827);
      border:1px solid var(--dsw-alias-border-l2,#374151);
      box-shadow:0 18px 60px rgba(0,0,0,.45);
    ">
      <div style="padding:22px 24px 6px; text-align:center;">
        <div style="font-size:44px; line-height:1;">🐳</div>
        <h2 style="margin:10px 0 6px; font-size:18px; font-weight:700;
          color:var(--dsw-alias-label-primary,#f3f4f6);">要离开了吗？</h2>
        <p style="margin:0; font-size:13px; line-height:1.7;
          color:var(--dsw-alias-label-secondary,#9ca3af);">
          小鲸鱼还在后台游着呢～<br/>
          「一起走」会带它离开，「留下小鲸鱼」让它继续陪你
        </p>
      </div>
      <div style="padding:16px 24px 22px; display:flex; flex-direction:column; gap:10px;">
        <button data-act="exit" style="
          padding:11px 0; border:none; border-radius:10px; cursor:pointer;
          font-size:14px; font-weight:700; color:#fff;
          background:linear-gradient(135deg,#fb7185,#f472b6);">
          一起走
        </button>
        <button data-act="close" style="
          padding:11px 0; border:none; border-radius:10px; cursor:pointer;
          font-size:14px; font-weight:700;
          color:var(--dsw-alias-label-primary-foreground,#fff);
          background:linear-gradient(135deg,#60a5fa,#818cf8);">
          留下小鲸鱼
        </button>
        <button data-act="cancel" style="
          padding:9px 0; border:1px solid var(--dsw-alias-border-l2,#475569);
          border-radius:10px; background:transparent; cursor:pointer;
          font-size:13px; color:var(--dsw-alias-label-tertiary,#94a3b8);">
          再陪我一会
        </button>
      </div>
    </div>`;
  d.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset?.act;
    if (!act) return;
    if (act === 'cancel') { d.remove(); return; }
    if (window.__TAURI__ && window.__TAURI__.invoke) {
      window.__TAURI__.invoke(act === 'exit' ? 'exit_app' : 'close_window')
        .catch(() => d.remove());
    } else {
      d.remove(); // no bridge (shouldn't happen): drop the dialog, stay open
    }
  });
  document.body.appendChild(d);
})();
"#;
    let _ = window.eval(script);
}

fn main() {
    let config = load_config();

    tauri::Builder::default()
        .manage(AppState {
            config: config.clone(),
            cancelled: Arc::new(AtomicBool::new(false)),
            service_pid: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![retry_start, exit_app, close_window])
        .setup(move |app| {
            let window = app
                .get_webview_window("main")
                .expect("main window must exist");

            // Match the window icon to the desktop shortcut icon: the plugin
            // persists the applied icon path in desktop-launcher.json, so
            // whichever icon the user picked for the shortcut is used here
            // too — no recompile needed when the icon changes.
            if let Some(icon_path) = config.icon_path.as_deref() {
                if std::path::Path::new(icon_path).is_file() {
                    match tauri::image::Image::from_path(icon_path) {
                        Ok(image) => {
                            window.set_icon(image).unwrap_or_else(|error| {
                                eprintln!("[dsh-desktop] set_icon failed: {error}");
                            });
                        }
                        Err(error) => eprintln!("[dsh-desktop] icon load failed: {error}"),
                    }
                }
            }

            // Navigate once the service is reachable (or immediately when it
            // already is). Runs off the main thread so the loading page shows.
            let state = app.state::<AppState>();
            let app_handle = app.handle().clone();
            let window_handle = window.clone();
            let config_handle = state.config.clone();
            let cancelled_start = state.cancelled.clone();
            let service_pid_start = state.service_pid.clone();
            thread::spawn(move || {
                try_start(&app_handle, &window_handle, &config_handle, &cancelled_start, &service_pid_start)
            });

            // Closing the window cancels the wait.
            let cancelled_close = state.cancelled.clone();
            let window_for_close = window.clone();

            // Intercept the X button: whenever the DSH service is running on
            // the configured port (whoever started it), inject the skin-aware
            // exit dialog into the current page (DSH GUI after navigation —
            // withGlobalTauri makes window.__TAURI__ available there, and the
            // --dsw-alias-* tokens follow the active theme). 「一起走」stops
            // the service; 「留下小鲸鱼」keeps it; 「再陪我一会」cancels.
            let state_close = app.state::<AppState>();
            let pid_guard = state_close.service_pid.clone();
            let port_guard = state_close.config.port;
            let window_for_ask = window.clone();
            window_for_close.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let service_up = port_open(port_guard)
                        || pid_guard.lock().map(|g| g.is_some()).unwrap_or(false);
                    if service_up {
                        // Prevent the default close; the dialog's buttons call
                        // exit_app / close_window, which decide the outcome.
                        api.prevent_close();
                        ask_exit_via_page(&window_for_ask);
                    }
                    // Service not running: let the default close proceed.
                } else if let tauri::WindowEvent::Destroyed = event {
                    cancelled_close.store(true, Ordering::Relaxed);
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running dsh-desktop");
}

#[cfg(test)]
mod tests {
    use super::LauncherConfig;

    #[test]
    fn parses_camel_case_keys_written_by_the_plugin() {
        let json = r#"{
            "url": "http://127.0.0.1:3080",
            "port": 3080,
            "startCommand": ["node", "web"],
            "startCwd": "D:\\deepseek-harness",
            "timeoutSecs": 30,
            "shellPath": "D:\\shell.exe",
            "iconPath": "D:\\icon.ico"
        }"#;
        let config: LauncherConfig = serde_json::from_str(json).expect("camelCase config must parse");
        assert_eq!(config.url, "http://127.0.0.1:3080");
        assert_eq!(config.port, 3080);
        let expected: Vec<String> = vec!["node".into(), "web".into()];
        assert_eq!(config.start_command.as_deref(), Some(expected.as_slice()));
        assert_eq!(config.start_cwd.as_deref(), Some("D:\\deepseek-harness"));
        assert_eq!(config.timeout_secs, 30);
        assert_eq!(config.icon_path.as_deref(), Some("D:\\icon.ico"));
    }

    #[test]
    fn empty_start_command_parses_as_empty_list() {
        let json = r#"{"startCommand": [], "startCwd": ""}"#;
        let config: LauncherConfig = serde_json::from_str(json).expect("empty array must parse");
        let expected: Vec<String> = vec![];
        assert_eq!(config.start_command.as_deref(), Some(expected.as_slice()));
        assert_eq!(config.start_cwd.as_deref(), Some(""));
    }

    #[test]
    fn missing_keys_fall_back_to_defaults() {
        let config: LauncherConfig = serde_json::from_str("{}").expect("empty object must parse");
        assert_eq!(config.url, "http://127.0.0.1:3080");
        assert_eq!(config.port, 3080);
        assert_eq!(config.start_command, None);
        assert_eq!(config.timeout_secs, 60);
        assert_eq!(config.icon_path, None);
    }
}
