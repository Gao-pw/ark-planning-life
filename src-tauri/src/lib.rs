use serde::{Deserialize, Serialize};
use serde_json::Value;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::Command;
use std::{env, path::PathBuf};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Runtime, WebviewWindow};

#[derive(Debug, Serialize, Deserialize, Clone)]
struct UsagePeriod {
    kind: String,
    percent: f64,
    reset_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct UsagePayload {
    ok: bool,
    message: String,
    product: String,
    version: String,
    region: String,
    periods: Vec<UsagePeriod>,
}

#[tauri::command]
fn fetch_usage() -> UsagePayload {
    match run_usage_cli() {
        Ok(stdout) => parse_usage_json(&stdout),
        Err(message) => error_payload(message),
    }
}

#[tauri::command]
fn set_always_on_top(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    window.set_always_on_top(enabled).map_err(|error| error.to_string())
}

#[tauri::command]
fn minimize_to_tray(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn show_detail_window(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    let window = app
        .get_webview_window("detail")
        .ok_or_else(|| "详情窗口不存在".to_string())?;
    window
        .set_position(LogicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    window
        .set_size(LogicalSize::new(760.0, 340.0))
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn hide_detail_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("detail")
        .ok_or_else(|| "详情窗口不存在".to_string())?;
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn toggle_detail_window(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    let window = app
        .get_webview_window("detail")
        .ok_or_else(|| "详情窗口不存在".to_string())?;

    if window.is_visible().map_err(|error| error.to_string())? {
        return window.hide().map_err(|error| error.to_string());
    }

    window
        .set_position(LogicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    window
        .set_size(LogicalSize::new(760.0, 340.0))
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

fn run_usage_cli() -> Result<String, String> {
    // 数据源：本地执行固定 CLI 命令，渲染层不直接接触 shell，降低权限暴露面。
    // Windows GUI 应用启动时 PATH 可能和终端不同，因此先按 PATH 查找 arkcli / arkcli.exe。
    let cli = find_arkcli().unwrap_or_else(|| PathBuf::from("arkcli"));

    let mut command = Command::new(&cli);
    command.args(["usage", "plan", "--product", "coding-plan"]);

    #[cfg(windows)]
    command.creation_flags(0x08000000);

    let output = command
        .output()
        .map_err(|error| format!("CLI 执行失败：{}：{error}", cli.display()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("CLI 执行失败：{} 返回非零退出码", cli.display())
        } else {
            format!("CLI 执行失败：{stderr}")
        });
    }

    String::from_utf8(output.stdout).map_err(|error| format!("CLI 输出不是 UTF-8：{error}"))
}

fn find_arkcli() -> Option<PathBuf> {
    let path_env = env::var_os("PATH")?;
    for dir in env::split_paths(&path_env) {
        for name in ["arkcli.exe", "arkcli.cmd", "arkcli.bat", "arkcli"] {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn extract_json(stdout: &str) -> Option<&str> {
    let start = stdout.find('{')?;
    let end = stdout.rfind('}')?;
    (start <= end).then_some(&stdout[start..=end])
}

fn parse_usage_json(stdout: &str) -> UsagePayload {
    let json_text = extract_json(stdout).unwrap_or(stdout.trim());
    let root: Value = match serde_json::from_str(json_text) {
        Ok(value) => value,
        Err(error) => return error_payload(format!("JSON 解析异常：{error}；输出片段：{}", stdout.chars().take(120).collect::<String>())),
    };

    // 关键解析路径：有效用量数据固定来自 items[0].periods。
    let Some(first_item) = root.get("items").and_then(Value::as_array).and_then(|items| items.first()) else {
        return error_payload("无 items 数据".to_string());
    };

    let Some(periods_value) = first_item.get("periods").and_then(Value::as_array) else {
        return error_payload("无 items[0].periods 数据".to_string());
    };

    let periods = periods_value
        .iter()
        .filter_map(|period| {
            let kind = period
                .get("label")
                .or_else(|| period.get("type"))
                .or_else(|| period.get("kind"))
                .or_else(|| period.get("name"))
                .or_else(|| period.get("period"))
                .and_then(Value::as_str)?
                .to_lowercase();
            let percent = period.get("percent").and_then(Value::as_f64).unwrap_or(0.0);
            let reset_at = period.get("reset_at").and_then(Value::as_i64);

            Some(UsagePeriod {
                kind,
                percent,
                reset_at,
            })
        })
        .collect::<Vec<_>>();

    if periods.is_empty() {
        return error_payload("periods 中没有可识别用量数据".to_string());
    }

    if !periods.iter().any(|period| period.kind == "monthly") {
        return error_payload("periods 中缺少 monthly 月度用量数据".to_string());
    }

    UsagePayload {
        ok: true,
        message: "ok".to_string(),
        product: "coding-plan".to_string(),
        version: first_item
            .get("edition")
            .or_else(|| first_item.get("version"))
            .and_then(Value::as_str)
            .unwrap_or("personal")
            .to_string(),
        region: root
            .get("viewer")
            .and_then(|viewer| viewer.get("region"))
            .or_else(|| first_item.get("region"))
            .and_then(Value::as_str)
            .unwrap_or("cn-beijing")
            .to_string(),
        periods,
    }
}

fn error_payload(message: String) -> UsagePayload {
    UsagePayload {
        ok: false,
        message,
        product: "coding-plan".to_string(),
        version: "personal".to_string(),
        region: "cn-beijing".to_string(),
        periods: Vec::new(),
    }
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "显示", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                .tooltip("Siroi CodeHeart")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });

            tray_builder = tray_builder.icon(tauri::include_image!("icons/32x32.png"));

            let tray = tray_builder.build(app)?;
            let _ = tray.set_visible(true);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_size(LogicalSize::new(420.0, 64.0));
                let _ = window.set_always_on_top(true);
                let _ = window.show();
                let _ = window.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fetch_usage,
            set_always_on_top,
            minimize_to_tray,
            show_detail_window,
            hide_detail_window,
            toggle_detail_window
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri app");
}
