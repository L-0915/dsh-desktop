//! dsh-desktop shell — standalone desktop window for the DeepSeek Harness
//! Web GUI.
//!
//! Startup flow:
//!   1. Load `desktop-launcher.json` (looked up under `$DSH_HOME`, then next
//!      to the executable) for the target URL, port, optional start command,
//!      and the icon path applied to the desktop shortcut.
//!   2. Probe the port; when the web service is not running and a start
//!      command is configured, spawn it in the background (hidden window on
//!      Windows) and poll until the port accepts connections.
//!   3. Load the URL in the webview, replacing the local loading page.
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

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::Manager;

/// Runtime configuration read from `desktop-launcher.json`.
#[derive(Debug, Clone, Deserialize)]
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

/// Spawn the configured start command detached from this process.
fn spawn_start_command(config: &LauncherConfig) {
    let Some(command) = &config.start_command else {
        eprintln!("[dsh-desktop] service down and no start command configured");
        return;
    };
    if command.is_empty() {
        return;
    }
    let program = &command[0];
    let args = &command[1..];
    let mut child = Command::new(program);
    child.args(args);
    if let Some(cwd) = &config.start_cwd {
        child.current_dir(cwd);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: keep the spawned service off the taskbar.
        child.creation_flags(0x0800_0000);
    }
    match child.spawn() {
        Ok(_) => eprintln!("[dsh-desktop] started: {} {}", program, args.join(" ")),
        Err(error) => eprintln!("[dsh-desktop] failed to start {program}: {error}"),
    }
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

fn main() {
    let config = load_config();
    let already_up = port_open(config.port);

    tauri::Builder::default()
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

            let url = config.url.clone();
            let port = config.port;
            let timeout = Duration::from_secs(config.timeout_secs);
            let cancelled = Arc::new(AtomicBool::new(false));
            let cancel_flag = cancelled.clone();
            let window_handle = window.clone();

            // Navigate once the service is reachable (or immediately when it
            // already is). Runs off the main thread so the loading page shows.
            thread::spawn(move || {
                let ready = if already_up {
                    true
                } else {
                    spawn_start_command(&config);
                    wait_for_port(port, timeout, &cancel_flag)
                };
                if ready {
                    eprintln!("[dsh-desktop] service up, loading {url}");
                    match url.parse::<url::Url>() {
                        Ok(parsed) => {
                            let _ = window_handle.navigate(parsed);
                        }
                        Err(error) => eprintln!("[dsh-desktop] invalid URL: {error}"),
                    }
                } else {
                    eprintln!("[dsh-desktop] service did not become ready in time");
                }
            });

            // Closing the window cancels the wait.
            let window_for_close = window.clone();
            window_for_close.on_window_event(move |event| {
                if let tauri::WindowEvent::Destroyed = event {
                    cancelled.store(true, Ordering::Relaxed);
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running dsh-desktop");
}
