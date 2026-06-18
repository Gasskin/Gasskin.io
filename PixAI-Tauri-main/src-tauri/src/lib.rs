use reqwest::{
    header::{HeaderValue, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_TYPE},
    Client, Method,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::HashMap,
    env,
    error::Error,
    fs,
    io::{Read, Write},
    net::{Shutdown, TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
#[cfg(target_os = "windows")]
use tauri::utils::{config::BundleType, platform::bundle_type};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri::{AppHandle, Emitter, Manager};
#[cfg(not(target_os = "windows"))]
use tauri_plugin_notification::NotificationExt;
#[cfg(target_os = "windows")]
use tauri_winrt_notification::{Duration as ToastDuration, Toast};
#[cfg(target_os = "windows")]
use winreg::{enums::*, RegKey};

const SECRET_SERVICE: &str = "PixAI-Tauri";
const CODEX_BRIDGE_HOST: &str = "127.0.0.1";
const CODEX_BRIDGE_PORT: u16 = 43117;
const MAX_CODEX_BRIDGE_REQUEST_BYTES: usize = 2 * 1024 * 1024;
const MAX_REFERENCE_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
const CODEX_BRIDGE_REQUEST_EVENT: &str = "pixai://codex-bridge/request";
#[cfg(target_os = "windows")]
const SYSTEM_NOTIFICATION_ACTIVATED_EVENT: &str = "pixai://system-notification/activated";
const TRAY_MENU_SHOW_ID: &str = "show";
const TRAY_MENU_QUIT_ID: &str = "quit";
static KEYRING_READY: OnceLock<bool> = OnceLock::new();
static CODEX_BRIDGE_STARTED: OnceLock<()> = OnceLock::new();
static HTTP_PROXY_CLIENT: OnceLock<Client> = OnceLock::new();
static CODEX_BRIDGE_READY: AtomicBool = AtomicBool::new(false);
static CODEX_BRIDGE_ACTIVE_PORT: AtomicU64 = AtomicU64::new(0);
static CODEX_BRIDGE_NEXT_ID: AtomicU64 = AtomicU64::new(1);
static CODEX_BRIDGE_PENDING: OnceLock<
    Mutex<HashMap<String, mpsc::Sender<CodexBridgeTransportResponse>>>,
> = OnceLock::new();

#[derive(Serialize)]
struct SecretWriteResult {
    insecure_storage: bool,
    backend: String,
}

#[derive(Serialize)]
struct SecretReadResult {
    value: Option<String>,
    insecure_storage: bool,
    backend: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopPlatformInfo {
    os: String,
    arch: String,
    installer_type: String,
}

#[derive(Deserialize)]
struct HttpProxyRequest {
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    #[serde(rename = "bodyBase64")]
    body_base64: Option<String>,
    #[serde(rename = "timeoutMs")]
    timeout_ms: Option<u64>,
    #[serde(rename = "firstByteTimeoutMs")]
    first_byte_timeout_ms: Option<u64>,
}

#[derive(Deserialize)]
struct HttpProxyStreamRequest {
    #[serde(rename = "streamId")]
    stream_id: String,
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    #[serde(rename = "bodyBase64")]
    body_base64: Option<String>,
    #[serde(rename = "timeoutMs")]
    timeout_ms: Option<u64>,
    #[serde(rename = "firstByteTimeoutMs")]
    first_byte_timeout_ms: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpProxyStreamEvent {
    stream_id: String,
    kind: String,
    status: Option<u16>,
    status_text: Option<String>,
    chunk_base64: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
struct HttpProxyResponse {
    status: u16,
    status_text: String,
    body: String,
}

#[derive(Deserialize)]
struct SystemNotificationRequest {
    title: String,
    body: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalImageReadResult {
    name: String,
    mime_type: String,
    data_url: String,
    file_size_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteImageReadResult {
    name: String,
    mime_type: String,
    data_url: String,
    file_size_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredDataUrlFile {
    path: String,
    data_url: String,
    mime_type: String,
    file_size_bytes: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexSkillInstallRequest {
    name: String,
    files: Vec<CodexSkillFile>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexSkillFile {
    relative_path: String,
    content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexSkillStatus {
    name: String,
    installed: bool,
    path: String,
    skill_md_path: String,
}

#[derive(Clone, Serialize)]
struct CodexBridgeTransportRequest {
    id: String,
    method: String,
    path: String,
    body: Option<String>,
    headers: HashMap<String, String>,
    port: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexBridgeTransportResponse {
    request_id: String,
    status: u16,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    body_base64: Option<String>,
}

#[derive(Debug, Clone)]
struct CodexBridgeHttpResponse {
    status: u16,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    body_base64: Option<String>,
    cors_origin: Option<String>,
}

#[tauri::command]
fn app_data_dir(app: AppHandle) -> Result<String, String> {
    Ok(app_data_path(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
fn app_installer_type() -> String {
    #[cfg(target_os = "windows")]
    {
        return match bundle_type() {
            Some(BundleType::Msi) => "msi".to_string(),
            Some(BundleType::Nsis) => "nsis".to_string(),
            _ => installed_app_installer_type()
                .unwrap_or("unknown")
                .to_string(),
        };
    }

    #[cfg(not(target_os = "windows"))]
    {
        "unknown".to_string()
    }
}

#[tauri::command]
fn desktop_platform_info() -> DesktopPlatformInfo {
    DesktopPlatformInfo {
        os: desktop_os().to_string(),
        arch: desktop_arch().to_string(),
        installer_type: app_installer_type(),
    }
}

fn desktop_os() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}

fn desktop_arch() -> &'static str {
    if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else if cfg!(target_arch = "x86") {
        "i686"
    } else if cfg!(target_arch = "arm") {
        "armv7"
    } else {
        "unknown"
    }
}

#[cfg(target_os = "windows")]
fn installed_app_installer_type() -> Option<&'static str> {
    for root in [
        RegKey::predef(HKEY_CURRENT_USER),
        RegKey::predef(HKEY_LOCAL_MACHINE),
    ] {
        if let Some(installer_type) = installed_app_installer_type_from_root(root) {
            return Some(installer_type);
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn installed_app_installer_type_from_root(root: RegKey) -> Option<&'static str> {
    let uninstall = root
        .open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            KEY_READ | KEY_WOW64_64KEY,
        )
        .ok()?;

    for subkey_name in uninstall.enum_keys().flatten() {
        let Ok(subkey) = uninstall.open_subkey_with_flags(&subkey_name, KEY_READ | KEY_WOW64_64KEY)
        else {
            continue;
        };

        let display_name = registry_string_value(&subkey, "DisplayName");
        let publisher = registry_string_value(&subkey, "Publisher");
        if !is_pixai_tauri_uninstall_entry(display_name.as_deref(), publisher.as_deref()) {
            continue;
        }

        let uninstall_string =
            registry_string_value(&subkey, "UninstallString").unwrap_or_default();
        if uninstall_string.to_ascii_lowercase().contains("msiexec") {
            return Some("msi");
        }
        return Some("nsis");
    }

    None
}

#[cfg(target_os = "windows")]
fn registry_string_value(key: &RegKey, name: &str) -> Option<String> {
    key.get_value::<String, _>(name)
        .ok()
        .map(|value| value.trim_matches('"').trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(target_os = "windows")]
fn is_pixai_tauri_uninstall_entry(display_name: Option<&str>, publisher: Option<&str>) -> bool {
    matches!(display_name, Some("PixAI"))
        && matches!(
            publisher.map(str::to_ascii_lowercase).as_deref(),
            Some("fingercaster")
        )
}

#[tauri::command]
fn read_json_state(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let path = data_file_path(&app, &name)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn write_json_state(app: AppHandle, name: String, payload: String) -> Result<(), String> {
    let path = data_file_path(&app, &name)?;
    fs::write(path, payload).map_err(|error| error.to_string())
}

#[tauri::command]
fn activate_main_window(app: AppHandle) -> Result<(), String> {
    activate_main_window_for(&app)
}

#[tauri::command]
fn hide_main_window(app: AppHandle) -> Result<(), String> {
    hide_main_window_for(&app)
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn send_system_notification(
    app: AppHandle,
    request: SystemNotificationRequest,
) -> Result<(), String> {
    send_system_notification_for(app, request)
}

#[tauri::command]
fn set_profile_secret(
    app: AppHandle,
    profile_id: String,
    api_key: String,
) -> Result<SecretWriteResult, String> {
    if api_key.trim().is_empty() {
        delete_profile_secret(app, profile_id)?;
        return Ok(SecretWriteResult {
            insecure_storage: false,
            backend: "none".to_string(),
        });
    }

    match keyring_entry(&profile_id).and_then(|entry| entry.set_password(api_key.trim())) {
        Ok(()) => {
            remove_fallback_secret(&app, &profile_id)?;
            Ok(SecretWriteResult {
                insecure_storage: false,
                backend: "keyring".to_string(),
            })
        }
        Err(_) => {
            write_fallback_secret(&app, &profile_id, api_key.trim())?;
            Ok(SecretWriteResult {
                insecure_storage: true,
                backend: "app-data-fallback".to_string(),
            })
        }
    }
}

#[tauri::command]
fn get_profile_secret(app: AppHandle, profile_id: String) -> Result<SecretReadResult, String> {
    if let Ok(entry) = keyring_entry(&profile_id) {
        if let Ok(value) = entry.get_password() {
            return Ok(SecretReadResult {
                value: Some(value),
                insecure_storage: false,
                backend: "keyring".to_string(),
            });
        }
    }

    Ok(SecretReadResult {
        value: read_fallback_secret(&app, &profile_id)?,
        insecure_storage: true,
        backend: "app-data-fallback".to_string(),
    })
}

#[tauri::command]
fn delete_profile_secret(app: AppHandle, profile_id: String) -> Result<(), String> {
    if let Ok(entry) = keyring_entry(&profile_id) {
        let _ = entry.delete_credential();
    }
    remove_fallback_secret(&app, &profile_id)
}

#[tauri::command]
async fn http_proxy(request: HttpProxyRequest) -> Result<HttpProxyResponse, String> {
    let url =
        reqwest::Url::parse(&request.url).map_err(|error| format!("接口地址无效：{error}"))?;
    match url.scheme() {
        "http" | "https" => {}
        _ => return Err("仅支持 HTTP/HTTPS 接口地址。".to_string()),
    }
    let request_url = url.as_str().to_string();
    let method = request
        .method
        .parse::<Method>()
        .map_err(|error| format!("请求方法无效：{error}"))?;
    let client = http_proxy_client()?;
    let mut builder = client.request(method, url);
    for (name, value) in request.headers {
        builder = builder.header(name, value);
    }
    if let Some(body_base64) = request.body_base64 {
        let body = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, body_base64)
            .map_err(|error| format!("请求体 base64 无效：{error}"))?;
        builder = builder.body(body);
    } else if let Some(body) = request.body {
        builder = builder.body(body);
    }
    let timeout_ms = request.timeout_ms.or(request.first_byte_timeout_ms);
    if let Some(timeout_ms) = timeout_ms {
        builder = builder.timeout(Duration::from_millis(timeout_ms.clamp(1_000, 1_800_000)));
    }
    let response = builder
        .send()
        .await
        .map_err(|error| format_http_proxy_error("send", request_url.as_str(), &error))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format_http_proxy_error("read-body", request_url.as_str(), &error))?;
    Ok(HttpProxyResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        body,
    })
}

#[tauri::command]
async fn http_proxy_stream(app: AppHandle, request: HttpProxyStreamRequest) -> Result<(), String> {
    let request_url =
        reqwest::Url::parse(&request.url).map_err(|error| format!("接口地址无效：{error}"))?;
    match request_url.scheme() {
        "http" | "https" => {}
        _ => return Err("仅支持 HTTP/HTTPS 接口地址。".to_string()),
    }
    let method = request
        .method
        .parse::<Method>()
        .map_err(|error| format!("请求方法无效：{error}"))?;
    let url_string = request_url.as_str().to_string();
    let client = http_proxy_client()?;
    let mut builder = client.request(method, request_url);
    for (name, value) in request.headers {
        builder = builder.header(name, value);
    }
    if let Some(body_base64) = request.body_base64 {
        let body = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, body_base64)
            .map_err(|error| format!("请求体 base64 无效：{error}"))?;
        builder = builder.body(body);
    } else if let Some(body) = request.body {
        builder = builder.body(body);
    }
    if let Some(timeout_ms) = request.timeout_ms {
        builder = builder.timeout(Duration::from_millis(timeout_ms.clamp(1_000, 1_800_000)));
    }
    let response = builder
        .send()
        .await
        .map_err(|error| format_http_proxy_error("send", url_string.as_str(), &error))?;
    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();
    let stream_id = request.stream_id;
    let first_byte_timeout = Duration::from_millis(
        request
            .first_byte_timeout_ms
            .unwrap_or(20_000)
            .clamp(1_000, 1_800_000),
    );
    let chunk_timeout = Duration::from_millis(
        request
            .timeout_ms
            .unwrap_or(300_000)
            .clamp(1_000, 1_800_000),
    );
    let mut saw_chunk = false;
    let mut response = response;

    loop {
        let timeout = if saw_chunk {
            chunk_timeout
        } else {
            first_byte_timeout
        };
        let chunk = match tokio::time::timeout(timeout, response.chunk()).await {
            Ok(Ok(value)) => value,
            Ok(Err(error)) => {
                emit_http_proxy_stream_error(
                    &app,
                    &stream_id,
                    Some(status.as_u16()),
                    Some(status_text.clone()),
                    format_http_proxy_error("read-chunk", url_string.as_str(), &error),
                );
                return Ok(());
            }
            Err(_) => {
                emit_http_proxy_stream_error(
                    &app,
                    &stream_id,
                    Some(status.as_u16()),
                    Some(status_text.clone()),
                    if saw_chunk {
                        "流式响应长时间没有新输出。".to_string()
                    } else {
                        "流式响应已连接但长时间没有输出。".to_string()
                    },
                );
                return Ok(());
            }
        };
        let Some(chunk) = chunk else {
            let _ = app.emit(
                "pixai://http-proxy-stream",
                HttpProxyStreamEvent {
                    stream_id,
                    kind: "done".to_string(),
                    status: Some(status.as_u16()),
                    status_text: Some(status_text),
                    chunk_base64: None,
                    error: None,
                },
            );
            return Ok(());
        };
        saw_chunk = true;
        let _ = app.emit(
            "pixai://http-proxy-stream",
            HttpProxyStreamEvent {
                stream_id: stream_id.clone(),
                kind: "chunk".to_string(),
                status: Some(status.as_u16()),
                status_text: Some(status_text.clone()),
                chunk_base64: Some(base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    chunk.as_ref(),
                )),
                error: None,
            },
        );
    }
}

fn emit_http_proxy_stream_error(
    app: &AppHandle,
    stream_id: &str,
    status: Option<u16>,
    status_text: Option<String>,
    error: String,
) {
    let _ = app.emit(
        "pixai://http-proxy-stream",
        HttpProxyStreamEvent {
            stream_id: stream_id.to_string(),
            kind: "error".to_string(),
            status,
            status_text,
            chunk_base64: None,
            error: Some(error),
        },
    );
}

fn http_proxy_client() -> Result<&'static Client, String> {
    if let Some(client) = HTTP_PROXY_CLIENT.get() {
        return Ok(client);
    }
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .pool_max_idle_per_host(0)
        .build()
        .map_err(|error| format_http_proxy_error("client-build", "", &error))?;
    let _ = HTTP_PROXY_CLIENT.set(client);
    HTTP_PROXY_CLIENT
        .get()
        .ok_or_else(|| "无法初始化 HTTP 客户端。".to_string())
}

fn format_http_proxy_error(stage: &str, url: &str, error: &reqwest::Error) -> String {
    let chain = error_chain(error);
    let payload = serde_json::json!({
        "stage": stage,
        "message": format!("请求接口失败：{error}"),
        "url": url,
        "isTimeout": error.is_timeout(),
        "isConnect": error.is_connect(),
        "isRequest": error.is_request(),
        "isBody": error.is_body(),
        "sourceChain": chain
    });
    serde_json::to_string(&payload).unwrap_or_else(|_| format!("请求接口失败：{error}"))
}

fn error_chain(error: &dyn Error) -> Vec<String> {
    let mut sources = Vec::new();
    let mut current = error.source();
    while let Some(source) = current {
        sources.push(source.to_string());
        current = source.source();
    }
    sources
}

#[tauri::command]
fn read_local_image_file(path: String) -> Result<LocalImageReadResult, String> {
    let resolved = PathBuf::from(&path);
    if !resolved.is_file() {
        return Err(format!("参考图不存在：{path}"));
    }
    let data = fs::read(&resolved).map_err(|error| error.to_string())?;
    let mime_type = mime_type_from_path(&resolved);
    let name = resolved
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("reference.png")
        .to_string();
    Ok(LocalImageReadResult {
        name,
        mime_type: mime_type.to_string(),
        data_url: format!(
            "data:{};base64,{}",
            mime_type,
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, data)
        ),
        file_size_bytes: fs::metadata(&resolved)
            .map_err(|error| error.to_string())?
        .len(),
    })
}

#[tauri::command]
async fn read_remote_image_url(url: String) -> Result<RemoteImageReadResult, String> {
    let request_url = reqwest::Url::parse(url.trim())
        .map_err(|_| "请输入有效的 HTTP/HTTPS 图片链接。".to_string())?;
    match request_url.scheme() {
        "http" | "https" => {}
        _ => return Err("仅支持 HTTP/HTTPS 图片链接。".to_string()),
    }

    let request_url_string = request_url.as_str().to_string();
    let client = http_proxy_client()?;
    let mut response = client
        .get(request_url.clone())
        .header("Accept", "image/png,image/jpeg,image/webp")
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|error| format_http_proxy_error("send", request_url_string.as_str(), &error))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("图片链接下载失败：HTTP {}。", status.as_u16()));
    }

    let content_length = response
        .content_length()
        .or_else(|| header_u64(response.headers().get(CONTENT_LENGTH)));
    if matches!(content_length, Some(length) if length > MAX_REFERENCE_IMAGE_BYTES) {
        return Err("单张参考图不能超过 20MB。".to_string());
    }

    let filename = remote_filename(&request_url, response.headers().get(CONTENT_DISPOSITION));
    let mime_type = normalize_remote_image_mime_type(response.headers().get(CONTENT_TYPE), &filename)?;
    let name = ensure_image_filename(&filename, mime_type);
    let mut data = Vec::with_capacity(
        content_length
            .unwrap_or(0)
            .min(MAX_REFERENCE_IMAGE_BYTES) as usize,
    );
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format_http_proxy_error("read-body", request_url_string.as_str(), &error))?
    {
        if data.len() as u64 + chunk.len() as u64 > MAX_REFERENCE_IMAGE_BYTES {
            return Err("单张参考图不能超过 20MB。".to_string());
        }
        data.extend_from_slice(chunk.as_ref());
    }

    Ok(RemoteImageReadResult {
        name,
        mime_type: mime_type.to_string(),
        data_url: format!(
            "data:{};base64,{}",
            mime_type,
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data)
        ),
        file_size_bytes: data.len() as u64,
    })
}

#[tauri::command]
fn write_data_url_file(
    directory: String,
    filename: String,
    data_url: String,
) -> Result<String, String> {
    let bytes = decode_data_url(&data_url)?;
    let directory = PathBuf::from(directory);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(sanitize_export_filename(&filename));
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn read_binary_file_base64(path: String) -> Result<String, String> {
    let resolved = PathBuf::from(path);
    if !resolved.is_file() {
        return Err("文件不存在。".to_string());
    }
    let data = fs::read(resolved).map_err(|error| error.to_string())?;
    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        data,
    ))
}

#[tauri::command]
fn write_binary_file(path: String, bytes_base64: String) -> Result<String, String> {
    let resolved = PathBuf::from(path);
    if let Some(parent) = resolved.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, bytes_base64)
        .map_err(|error| format!("图片数据无效：{error}"))?;
    fs::write(&resolved, bytes).map_err(|error| error.to_string())?;
    Ok(resolved.to_string_lossy().to_string())
}

#[tauri::command]
fn write_binary_file_in_directory(
    directory: String,
    filename: String,
    bytes_base64: String,
) -> Result<String, String> {
    let directory = PathBuf::from(directory);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = unique_file_path(&directory, &sanitize_export_filename(&filename));
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, bytes_base64)
        .map_err(|error| format!("图片数据无效：{error}"))?;
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn copy_binary_file(source: String, directory: String, filename: String) -> Result<String, String> {
    let source_path = PathBuf::from(source);
    if !source_path.is_file() {
        return Err("源文件不存在。".to_string());
    }
    let directory = PathBuf::from(directory);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = unique_file_path(&directory, &sanitize_export_filename(&filename));
    fs::copy(&source_path, &path).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn store_data_url_file(
    app: AppHandle,
    namespace: String,
    filename: String,
    data_url: String,
) -> Result<StoredDataUrlFile, String> {
    let bytes = decode_data_url(&data_url)?;
    let mime_type = mime_type_from_data_url(&data_url).to_string();
    let directory = app_data_path(&app)?.join(sanitize_name(&namespace)?);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = unique_file_path(&directory, &sanitize_export_filename(&filename));
    fs::write(&path, &bytes).map_err(|error| error.to_string())?;
    Ok(StoredDataUrlFile {
        path: path.to_string_lossy().to_string(),
        data_url: path_to_file_url(&path),
        mime_type,
        file_size_bytes: bytes.len() as u64,
    })
}

#[tauri::command]
fn codex_skill_status(name: String) -> Result<CodexSkillStatus, String> {
    let skill_name = sanitize_skill_name(&name)?;
    codex_skill_status_in(&codex_skills_dir()?, skill_name)
}

#[tauri::command]
fn install_codex_skill(request: CodexSkillInstallRequest) -> Result<CodexSkillStatus, String> {
    install_codex_skill_in(&codex_skills_dir()?, request)
}

fn install_codex_skill_in(
    skills_dir: &Path,
    request: CodexSkillInstallRequest,
) -> Result<CodexSkillStatus, String> {
    let skill_name = sanitize_skill_name(&request.name)?;
    if request.files.is_empty() {
        return Err("Skill 文件列表不能为空。".to_string());
    }

    let skill_path = skills_dir.join(&skill_name);
    fs::create_dir_all(&skill_path).map_err(|error| error.to_string())?;
    for file in request.files {
        let relative_path = sanitize_skill_relative_path(&file.relative_path)?;
        let output_path = skill_path.join(relative_path);
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(output_path, file.content).map_err(|error| error.to_string())?;
    }

    let active_port = CODEX_BRIDGE_ACTIVE_PORT.load(Ordering::Acquire);
    if skill_name == "pixai-image-workbench" && active_port > 0 {
        write_codex_bridge_state(active_port as u16);
    }

    codex_skill_status_in(skills_dir, skill_name)
}

fn codex_skill_status_in(
    skills_dir: &Path,
    skill_name: String,
) -> Result<CodexSkillStatus, String> {
    let path = skills_dir.join(&skill_name);
    let skill_md_path = path.join("SKILL.md");
    Ok(CodexSkillStatus {
        name: skill_name,
        installed: skill_md_path.is_file(),
        path: path.to_string_lossy().to_string(),
        skill_md_path: skill_md_path.to_string_lossy().to_string(),
    })
}

fn write_codex_bridge_state(port: u16) {
    let Ok(skills_dir) = codex_skills_dir() else {
        return;
    };
    let skill_path = skills_dir.join("pixai-image-workbench");
    if !skill_path.is_dir() {
        return;
    }
    let payload = serde_json::json!({
        "url": format!("http://{CODEX_BRIDGE_HOST}:{port}"),
        "host": CODEX_BRIDGE_HOST,
        "port": port,
        "updatedAt": current_timestamp()
    });
    let _ = fs::write(skill_path.join("bridge.json"), format!("{}\n", payload));
}

fn current_timestamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

#[tauri::command]
fn codex_bridge_respond(response: CodexBridgeTransportResponse) -> Result<(), String> {
    let pending = CODEX_BRIDGE_PENDING.get_or_init(|| Mutex::new(HashMap::new()));
    let sender = pending
        .lock()
        .map_err(|_| "Codex Bridge response queue is unavailable.".to_string())?
        .remove(&response.request_id)
        .ok_or_else(|| "Codex Bridge request is no longer pending.".to_string())?;
    sender
        .send(response)
        .map_err(|_| "Codex Bridge request listener is closed.".to_string())
}

#[tauri::command]
fn codex_bridge_ready() {
    CODEX_BRIDGE_READY.store(true, Ordering::Release);
}

fn app_data_path(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn data_file_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let safe_name = sanitize_name(name)?;
    Ok(app_data_path(app)?.join(format!("{safe_name}.json")))
}

fn activate_main_window_for(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app.show();
    }

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found.".to_string())?;
    let _ = window.show();
    let _ = window.unminimize();
    window.set_focus().map_err(|error| error.to_string())
}

fn hide_main_window_for(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found.".to_string())?;
    window.hide().map_err(|error| error.to_string())
}

fn setup_system_tray(app: &mut tauri::App) -> Result<(), Box<dyn Error>> {
    let show = MenuItem::with_id(app, TRAY_MENU_SHOW_ID, "打开 PixAI", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, TRAY_MENU_QUIT_ID, "退出 PixAI", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("PixAI")
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => {
                let _ = activate_main_window_for(tray.app_handle());
            }
            _ => {}
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_MENU_SHOW_ID => {
                let _ = activate_main_window_for(app);
            }
            TRAY_MENU_QUIT_ID => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn send_system_notification_for(
    app: AppHandle,
    request: SystemNotificationRequest,
) -> Result<(), String> {
    let app_id = notification_app_id(&app);
    let mut toast = Toast::new(&app_id)
        .title(&request.title)
        .duration(ToastDuration::Short)
        .on_activated(move |_| {
            let _ = activate_main_window_for(&app);
            let _ = app.emit(SYSTEM_NOTIFICATION_ACTIVATED_EVENT, ());
            Ok(())
        });
    if let Some(body) = request
        .body
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        toast = toast.text2(body);
    }
    toast.show().map_err(|error| error.to_string())
}

#[cfg(not(target_os = "windows"))]
fn send_system_notification_for(
    app: AppHandle,
    request: SystemNotificationRequest,
) -> Result<(), String> {
    let mut builder = app.notification().builder().title(request.title);
    if let Some(body) = request.body {
        builder = builder.body(body);
    }
    builder.show().map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn notification_app_id(app: &AppHandle) -> String {
    let identifier = app.config().identifier.clone();
    let installed = env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .map(|path| {
            let current = path.display().to_string();
            let release_suffix = format!(
                "{}target{}release",
                std::path::MAIN_SEPARATOR,
                std::path::MAIN_SEPARATOR
            );
            let debug_suffix = format!(
                "{}target{}debug",
                std::path::MAIN_SEPARATOR,
                std::path::MAIN_SEPARATOR
            );
            !current.ends_with(&release_suffix) && !current.ends_with(&debug_suffix)
        })
        .unwrap_or(false);
    if installed {
        identifier
    } else {
        Toast::POWERSHELL_APP_ID.to_string()
    }
}

fn secrets_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_path(app)?.join("secrets-fallback.json"))
}

fn keyring_entry(profile_id: &str) -> keyring_core::Result<keyring_core::Entry> {
    if !*KEYRING_READY.get_or_init(|| keyring::use_native_store(false).is_ok()) {
        return Err(keyring_core::Error::NoDefaultStore);
    }
    keyring_core::Entry::new(SECRET_SERVICE, &format!("profile:{profile_id}"))
}

fn read_fallback_secret(app: &AppHandle, profile_id: &str) -> Result<Option<String>, String> {
    let secrets = read_fallback_secrets(app)?;
    Ok(secrets
        .get(profile_id)
        .and_then(Value::as_str)
        .map(ToString::to_string))
}

fn write_fallback_secret(app: &AppHandle, profile_id: &str, api_key: &str) -> Result<(), String> {
    let mut secrets = read_fallback_secrets(app)?;
    secrets.insert(profile_id.to_string(), Value::String(api_key.to_string()));
    write_fallback_secrets(app, secrets)
}

fn remove_fallback_secret(app: &AppHandle, profile_id: &str) -> Result<(), String> {
    let mut secrets = read_fallback_secrets(app)?;
    secrets.remove(profile_id);
    write_fallback_secrets(app, secrets)
}

fn read_fallback_secrets(app: &AppHandle) -> Result<Map<String, Value>, String> {
    let path = secrets_file_path(app)?;
    if !path.exists() {
        return Ok(Map::new());
    }
    let value = fs::read_to_string(path)
        .map_err(|error| error.to_string())
        .and_then(|payload| {
            serde_json::from_str::<Value>(&payload).map_err(|error| error.to_string())
        })?;
    Ok(value.as_object().cloned().unwrap_or_default())
}

fn write_fallback_secrets(app: &AppHandle, secrets: Map<String, Value>) -> Result<(), String> {
    let payload =
        serde_json::to_string_pretty(&Value::Object(secrets)).map_err(|error| error.to_string())?;
    fs::write(secrets_file_path(app)?, format!("{payload}\n")).map_err(|error| error.to_string())
}

fn sanitize_name(name: &str) -> Result<String, String> {
    let candidate = Path::new(name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .collect::<String>();
    if candidate.is_empty() {
        return Err("Invalid state file name.".to_string());
    }
    Ok(candidate)
}

fn start_codex_bridge(app: AppHandle) {
    if env::var("PIXAI_CODEX_BRIDGE").ok().as_deref() == Some("0") {
        return;
    }
    if CODEX_BRIDGE_STARTED.set(()).is_err() {
        return;
    }

    let preferred_port = env::var("PIXAI_CODEX_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(CODEX_BRIDGE_PORT);

    thread::spawn(move || {
        let (listener, port) = match bind_codex_bridge_listener(preferred_port) {
            Some(result) => result,
            None => return,
        };
        CODEX_BRIDGE_ACTIVE_PORT.store(port as u64, Ordering::Release);
        write_codex_bridge_state(port);
        eprintln!("[PixAI Codex] Bridge listening on http://{CODEX_BRIDGE_HOST}:{port}");
        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    let app = app.clone();
                    thread::spawn(move || handle_codex_bridge_stream(app, stream, port));
                }
                Err(error) => eprintln!("[PixAI Codex] Bridge connection failed: {error}"),
            }
        }
    });
}

fn bind_codex_bridge_listener(preferred_port: u16) -> Option<(TcpListener, u16)> {
    match TcpListener::bind((CODEX_BRIDGE_HOST, preferred_port)) {
        Ok(listener) => return Some((listener, preferred_port)),
        Err(error) => {
            eprintln!(
                "[PixAI Codex] Bridge failed to bind {CODEX_BRIDGE_HOST}:{preferred_port}: {error}"
            );
        }
    }
    if env::var("PIXAI_CODEX_PORT").is_ok() {
        return None;
    }
    match TcpListener::bind((CODEX_BRIDGE_HOST, 0)) {
        Ok(listener) => {
            let port = listener
                .local_addr()
                .map(|address| address.port())
                .unwrap_or(CODEX_BRIDGE_PORT);
            eprintln!("[PixAI Codex] Bridge falling back to http://{CODEX_BRIDGE_HOST}:{port}");
            Some((listener, port))
        }
        Err(error) => {
            eprintln!("[PixAI Codex] Bridge failed to bind fallback port: {error}");
            None
        }
    }
}

fn handle_codex_bridge_stream(app: AppHandle, mut stream: TcpStream, port: u16) {
    let response = match read_http_request(&mut stream) {
        Ok(request) => match bridge_cors_origin(request.headers.get("origin"), port) {
            Ok(cors_origin) => {
                let mut response =
                    dispatch_codex_bridge_request(app, request, port).into_http_response();
                response.cors_origin = cors_origin;
                response
            }
            Err(()) => CodexBridgeHttpResponse {
                status: 403,
                headers: None,
                body: Some(json_error("Codex Bridge 只接受本机来源请求。")),
                body_base64: None,
                cors_origin: None,
            },
        },
        Err(error) => CodexBridgeHttpResponse {
            status: error.status,
            headers: None,
            body: Some(json_error(&error.message)),
            body_base64: None,
            cors_origin: None,
        },
    };
    let _ = write_http_response(&mut stream, response);
    let _ = stream.flush();
    let _ = stream.shutdown(Shutdown::Both);
}

fn dispatch_codex_bridge_request(
    app: AppHandle,
    request: ParsedHttpRequest,
    port: u16,
) -> CodexBridgeTransportResponse {
    if request.method == "OPTIONS" {
        return CodexBridgeTransportResponse {
            request_id: String::new(),
            status: 204,
            headers: None,
            body: Some(String::new()),
            body_base64: None,
        };
    }
    let route_path = request.path.split('?').next().unwrap_or(&request.path);
    if request.method == "GET" && route_path == "/health" {
        return CodexBridgeTransportResponse {
            request_id: String::new(),
            status: 200,
            headers: None,
            body: Some(
                serde_json::json!({
                    "ok": true,
                    "app": "PixAI",
                    "version": env!("CARGO_PKG_VERSION"),
                    "bridge": "codex",
                    "host": CODEX_BRIDGE_HOST,
                    "port": port,
                    "rendererReady": CODEX_BRIDGE_READY.load(Ordering::Acquire),
                    "endpoints": [
                        "GET /health",
                        "GET /settings",
                        "PATCH /settings",
                        "GET /conversations",
                        "POST /conversations",
                        "GET /history",
                        "GET /images/:id",
                        "GET /images/:id/file",
                        "DELETE /images/:id",
                        "PATCH /images/:id/favorite",
                        "POST /images/:id/reedit",
                        "POST /generate",
                        "POST /prompt/inspire",
                        "POST /prompt/enrich"
                    ]
                })
                .to_string(),
            ),
            body_base64: None,
        };
    }
    if !CODEX_BRIDGE_READY.load(Ordering::Acquire) {
        return CodexBridgeTransportResponse {
            request_id: String::new(),
            status: 503,
            headers: None,
            body: Some(json_error("Codex Bridge 前端处理器尚未就绪。")),
            body_base64: None,
        };
    }

    let id = format!(
        "bridge-{}",
        CODEX_BRIDGE_NEXT_ID.fetch_add(1, Ordering::Relaxed)
    );
    let payload = CodexBridgeTransportRequest {
        id: id.clone(),
        method: request.method,
        path: request.path,
        body: request.body,
        headers: request.headers,
        port,
    };
    let (sender, receiver) = mpsc::channel();
    if let Ok(mut pending) = CODEX_BRIDGE_PENDING
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
    {
        pending.insert(id.clone(), sender);
    }

    if let Err(error) = app.emit_to("main", CODEX_BRIDGE_REQUEST_EVENT, payload) {
        remove_pending_codex_bridge_request(&id);
        return CodexBridgeTransportResponse {
            request_id: id,
            status: 503,
            headers: None,
            body: Some(json_error(&format!(
                "Codex Bridge 前端处理器不可用：{error}"
            ))),
            body_base64: None,
        };
    }

    match receiver.recv_timeout(Duration::from_secs(60 * 30)) {
        Ok(response) => response,
        Err(_) => {
            remove_pending_codex_bridge_request(&id);
            CodexBridgeTransportResponse {
                request_id: id,
                status: 504,
                headers: None,
                body: Some(json_error("Codex Bridge 请求超时。")),
                body_base64: None,
            }
        }
    }
}

fn remove_pending_codex_bridge_request(id: &str) {
    if let Some(pending) = CODEX_BRIDGE_PENDING.get() {
        if let Ok(mut pending) = pending.lock() {
            pending.remove(id);
        }
    }
}

#[derive(Debug)]
struct ParsedHttpRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Option<String>,
}

#[derive(Debug)]
struct HttpParseError {
    status: u16,
    message: String,
}

fn read_http_request(stream: &mut TcpStream) -> Result<ParsedHttpRequest, HttpParseError> {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| HttpParseError {
            status: 500,
            message: error.to_string(),
        })?;
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 8192];
    let header_end = loop {
        let size = stream.read(&mut chunk).map_err(|error| HttpParseError {
            status: 400,
            message: error.to_string(),
        })?;
        if size == 0 {
            return Err(HttpParseError {
                status: 400,
                message: "请求为空。".to_string(),
            });
        }
        buffer.extend_from_slice(&chunk[..size]);
        if buffer.len() > MAX_CODEX_BRIDGE_REQUEST_BYTES {
            return Err(HttpParseError {
                status: 413,
                message: "请求体过大。".to_string(),
            });
        }
        if let Some(index) = find_header_end(&buffer) {
            break index;
        }
    };

    let header_bytes = &buffer[..header_end];
    let header_text = String::from_utf8(header_bytes.to_vec()).map_err(|_| HttpParseError {
        status: 400,
        message: "HTTP 头不是有效 UTF-8。".to_string(),
    })?;
    let mut lines = header_text.split("\r\n");
    let request_line = lines.next().ok_or_else(|| HttpParseError {
        status: 400,
        message: "请求行为空。".to_string(),
    })?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or("").to_ascii_uppercase();
    let path = request_parts.next().unwrap_or("").to_string();
    if method.is_empty() || path.is_empty() {
        return Err(HttpParseError {
            status: 400,
            message: "请求行无效。".to_string(),
        });
    }

    let mut headers = HashMap::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    if content_length > MAX_CODEX_BRIDGE_REQUEST_BYTES {
        return Err(HttpParseError {
            status: 413,
            message: "请求体过大。".to_string(),
        });
    }

    let body_start = header_end + 4;
    while buffer.len().saturating_sub(body_start) < content_length {
        let size = stream.read(&mut chunk).map_err(|error| HttpParseError {
            status: 400,
            message: error.to_string(),
        })?;
        if size == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..size]);
        if buffer.len() > MAX_CODEX_BRIDGE_REQUEST_BYTES + body_start {
            return Err(HttpParseError {
                status: 413,
                message: "请求体过大。".to_string(),
            });
        }
    }

    let body = if content_length > 0 {
        Some(
            String::from_utf8(buffer[body_start..body_start + content_length].to_vec()).map_err(
                |_| HttpParseError {
                    status: 400,
                    message: "请求体不是有效 UTF-8。".to_string(),
                },
            )?,
        )
    } else {
        None
    };

    Ok(ParsedHttpRequest {
        method,
        path,
        headers,
        body,
    })
}

fn write_http_response(
    stream: &mut TcpStream,
    response: CodexBridgeHttpResponse,
) -> std::io::Result<()> {
    let mut headers = response.headers.unwrap_or_default();
    let body = if let Some(body_base64) = response.body_base64 {
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, body_base64)
            .unwrap_or_else(|_| Vec::new())
    } else {
        if !headers.contains_key("Content-Type") {
            headers.insert(
                "Content-Type".to_string(),
                "application/json; charset=utf-8".to_string(),
            );
        }
        response.body.unwrap_or_default().into_bytes()
    };
    if let Some(cors_origin) = response.cors_origin {
        headers.insert("Access-Control-Allow-Origin".to_string(), cors_origin);
    }
    headers.insert(
        "Access-Control-Allow-Headers".to_string(),
        "Content-Type".to_string(),
    );
    headers.insert(
        "Access-Control-Allow-Methods".to_string(),
        "GET,POST,PATCH,DELETE,OPTIONS".to_string(),
    );
    headers.insert("Content-Length".to_string(), body.len().to_string());

    let reason = status_reason(response.status);
    write!(stream, "HTTP/1.1 {} {}\r\n", response.status, reason)?;
    for (name, value) in headers {
        write!(stream, "{name}: {value}\r\n")?;
    }
    write!(stream, "\r\n")?;
    stream.write_all(&body)
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn bridge_cors_origin(origin: Option<&String>, port: u16) -> Result<Option<String>, ()> {
    let Some(origin) = origin else {
        return Ok(None);
    };
    if origin == "null"
        || origin == &format!("http://{CODEX_BRIDGE_HOST}:{port}")
        || origin == &format!("http://localhost:{port}")
        || origin.starts_with("http://127.0.0.1:")
        || origin.starts_with("http://localhost:")
        || origin.starts_with("https://127.0.0.1:")
        || origin.starts_with("https://localhost:")
    {
        Ok(Some(origin.clone()))
    } else {
        Err(())
    }
}

fn json_error(message: &str) -> String {
    serde_json::json!({
        "ok": false,
        "error": message
    })
    .to_string()
}

fn decode_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let (_, base64_payload) = data_url
        .split_once(";base64,")
        .ok_or_else(|| "图片数据必须是 base64 data URL。".to_string())?;
    base64::Engine::decode(&base64::engine::general_purpose::STANDARD, base64_payload)
        .map_err(|error| error.to_string())
}

fn mime_type_from_data_url(data_url: &str) -> &str {
    data_url
        .strip_prefix("data:")
        .and_then(|value| value.split_once(";base64,").map(|(mime_type, _)| mime_type))
        .unwrap_or("image/png")
}

fn mime_type_from_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "image/png",
    }
}

fn header_u64(value: Option<&HeaderValue>) -> Option<u64> {
    value
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
}

fn remote_filename(url: &reqwest::Url, content_disposition: Option<&HeaderValue>) -> String {
    if let Some(filename) = filename_from_content_disposition(content_disposition) {
        return sanitize_remote_filename(&filename);
    }
    let raw_name = url
        .path_segments()
        .and_then(|segments| segments.filter(|segment| !segment.is_empty()).last())
        .unwrap_or("");
    let decoded_name = decode_percent_component(raw_name);
    sanitize_remote_filename(if decoded_name.trim().is_empty() {
        "reference.png"
    } else {
        decoded_name.as_str()
    })
}

fn filename_from_content_disposition(value: Option<&HeaderValue>) -> Option<String> {
    let value = value?.to_str().ok()?;
    for part in value.split(';').map(str::trim) {
        let Some((name, raw_value)) = part.split_once('=') else {
            continue;
        };
        if name.trim().eq_ignore_ascii_case("filename*") {
            let raw_value = raw_value.trim().trim_matches('"');
            let encoded = raw_value.splitn(3, '\'').nth(2).unwrap_or(raw_value);
            let decoded = decode_percent_component(encoded);
            if !decoded.trim().is_empty() {
                return Some(decoded);
            }
        }
    }
    for part in value.split(';').map(str::trim) {
        let Some((name, raw_value)) = part.split_once('=') else {
            continue;
        };
        if name.trim().eq_ignore_ascii_case("filename") {
            let filename = raw_value.trim().trim_matches('"').to_string();
            if !filename.trim().is_empty() {
                return Some(filename);
            }
        }
    }
    None
}

fn decode_percent_component(value: &str) -> String {
    let input = value.as_bytes();
    let mut output = Vec::with_capacity(input.len());
    let mut index = 0;
    while index < input.len() {
        if input[index] == b'%' && index + 2 < input.len() {
            if let (Some(high), Some(low)) =
                (hex_value(input[index + 1]), hex_value(input[index + 2]))
            {
                output.push((high << 4) | low);
                index += 3;
                continue;
            }
        }
        output.push(input[index]);
        index += 1;
    }
    match String::from_utf8(output) {
        Ok(value) => value,
        Err(error) => String::from_utf8_lossy(&error.into_bytes()).into_owned(),
    }
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn sanitize_remote_filename(value: &str) -> String {
    let filename = value
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(value)
        .chars()
        .filter(|ch| !ch.is_control() && *ch != '/' && *ch != '\\')
        .collect::<String>()
        .trim()
        .to_string();
    if filename.is_empty() {
        "reference.png".to_string()
    } else {
        filename
    }
}

fn normalize_remote_image_mime_type(
    content_type: Option<&HeaderValue>,
    filename: &str,
) -> Result<&'static str, String> {
    let header_mime_type = content_type
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .unwrap_or("")
        .to_ascii_lowercase();
    if let Some(mime_type) = supported_reference_mime_type(&header_mime_type) {
        return Ok(mime_type);
    }
    if !header_mime_type.is_empty()
        && header_mime_type != "application/octet-stream"
        && header_mime_type != "binary/octet-stream"
    {
        return Err("仅支持 PNG、JPG、WEBP 参考图。".to_string());
    }
    mime_type_from_filename(filename).ok_or_else(|| "仅支持 PNG、JPG、WEBP 参考图。".to_string())
}

fn supported_reference_mime_type(value: &str) -> Option<&'static str> {
    match value {
        "image/png" => Some("image/png"),
        "image/jpeg" | "image/jpg" => Some("image/jpeg"),
        "image/webp" => Some("image/webp"),
        _ => None,
    }
}

fn mime_type_from_filename(filename: &str) -> Option<&'static str> {
    match Path::new(filename)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

fn ensure_image_filename(filename: &str, mime_type: &str) -> String {
    if mime_type_from_filename(filename).is_some() {
        return filename.to_string();
    }
    let stem = Path::new(filename)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("reference");
    format!("{stem}.{}", extension_from_mime_type(mime_type))
}

fn extension_from_mime_type(mime_type: &str) -> &'static str {
    match mime_type {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        _ => "png",
    }
}

fn unique_file_path(directory: &Path, filename: &str) -> PathBuf {
    let candidate = directory.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(filename);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("png");
    for index in 1.. {
        let candidate = directory.join(format!("{stem}-{index}.{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!("unique file path loop should always return")
}

fn path_to_file_url(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn sanitize_export_filename(filename: &str) -> String {
    let candidate = filename
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if candidate.is_empty() {
        "pixai-image.png".to_string()
    } else {
        candidate
    }
}

fn codex_skills_dir() -> Result<PathBuf, String> {
    let codex_home = env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join(".codex")))
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".codex")))
        .ok_or_else(|| "无法定位 Codex 全局目录。".to_string())?;
    Ok(codex_home.join("skills"))
}

fn sanitize_skill_name(name: &str) -> Result<String, String> {
    let is_valid = !name.is_empty()
        && name.len() < 64
        && name
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
        && !name.starts_with('-')
        && !name.ends_with('-');
    if is_valid {
        Ok(name.to_string())
    } else {
        Err("Skill 名称只能包含小写字母、数字和连字符。".to_string())
    }
}

fn sanitize_skill_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative_path);
    if path.is_absolute() || relative_path.trim().is_empty() {
        return Err("Skill 文件路径必须是相对路径。".to_string());
    }
    let mut output = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::Normal(value) => output.push(value),
            _ => return Err("Skill 文件路径不能包含 .. 或特殊路径段。".to_string()),
        }
    }
    if output.as_os_str().is_empty() {
        Err("Skill 文件路径不能为空。".to_string())
    } else {
        Ok(output)
    }
}

fn status_reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        202 => "Accepted",
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        413 => "Payload Too Large",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "OK",
    }
}

impl CodexBridgeTransportResponse {
    fn into_http_response(self) -> CodexBridgeHttpResponse {
        CodexBridgeHttpResponse {
            status: self.status,
            headers: self.headers,
            body: self.body,
            body_base64: self.body_base64,
            cors_origin: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installs_codex_skill_files_under_the_selected_skills_directory() {
        let skills_dir = env::temp_dir().join(format!(
            "pixai-skill-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let request = CodexSkillInstallRequest {
            name: "pixai-image-workbench".to_string(),
            files: vec![
                CodexSkillFile {
                    relative_path: "SKILL.md".to_string(),
                    content: "---\nname: pixai-image-workbench\ndescription: test\n---\n"
                        .to_string(),
                },
                CodexSkillFile {
                    relative_path: "scripts/pixai-codex.mjs".to_string(),
                    content: "#!/usr/bin/env node\n".to_string(),
                },
            ],
        };

        let status = install_codex_skill_in(&skills_dir, request).expect("skill installs");

        assert!(status.installed);
        assert_eq!(status.name, "pixai-image-workbench");
        assert!(skills_dir
            .join("pixai-image-workbench")
            .join("SKILL.md")
            .is_file());
        assert!(skills_dir
            .join("pixai-image-workbench")
            .join("scripts")
            .join("pixai-codex.mjs")
            .is_file());

        let _ = fs::remove_dir_all(skills_dir);
    }

    #[test]
    fn falls_back_to_an_ephemeral_port_when_the_preferred_port_is_occupied() {
        if env::var("PIXAI_CODEX_PORT").is_ok() {
            return;
        }

        let occupied = TcpListener::bind(("127.0.0.1", 0)).expect("bind occupied port");
        let occupied_port = occupied.local_addr().expect("occupied port").port();

        let (listener, fallback_port) =
            bind_codex_bridge_listener(occupied_port).expect("fallback listener");

        assert_ne!(fallback_port, occupied_port);
        assert_ne!(fallback_port, 0);
        drop(listener);
        drop(occupied);
    }

    #[test]
    fn rejects_codex_skill_path_traversal() {
        let skills_dir = env::temp_dir().join("pixai-skill-path-traversal-test");
        let request = CodexSkillInstallRequest {
            name: "pixai-image-workbench".to_string(),
            files: vec![CodexSkillFile {
                relative_path: "../outside.md".to_string(),
                content: "bad".to_string(),
            }],
        };

        let error = install_codex_skill_in(&skills_dir, request).expect_err("path is rejected");

        assert!(error.contains(".."));
        let _ = fs::remove_dir_all(skills_dir);
    }

    #[test]
    fn formats_http_proxy_errors_as_diagnostic_json() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind test port");
        let url = format!("http://{}", listener.local_addr().expect("test port"));
        drop(listener);
        let error = tauri::async_runtime::block_on(async {
            reqwest::Client::builder()
                .build()
                .unwrap()
                .get(&url)
                .send()
                .await
                .unwrap_err()
        });

        let formatted = format_http_proxy_error(
            "send",
            "https://ai-pixel.online/v1/images/generations",
            &error,
        );
        let payload: Value = serde_json::from_str(&formatted).expect("diagnostic json");

        assert_eq!(payload["stage"], "send");
        assert_eq!(
            payload["url"],
            "https://ai-pixel.online/v1/images/generations"
        );
        assert!(payload["message"]
            .as_str()
            .unwrap_or("")
            .contains("请求接口失败"));
        assert!(payload["isRequest"].is_boolean());
        assert!(payload["sourceChain"].is_array());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = activate_main_window_for(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            setup_system_tray(app)?;
            start_codex_bridge(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_data_dir,
            app_installer_type,
            desktop_platform_info,
            activate_main_window,
            hide_main_window,
            quit_app,
            send_system_notification,
            read_json_state,
            write_json_state,
            set_profile_secret,
            get_profile_secret,
            delete_profile_secret,
            http_proxy,
            http_proxy_stream,
            read_local_image_file,
            read_remote_image_url,
            write_data_url_file,
            read_binary_file_base64,
            write_binary_file,
            write_binary_file_in_directory,
            copy_binary_file,
            store_data_url_file,
            codex_skill_status,
            install_codex_skill,
            codex_bridge_respond,
            codex_bridge_ready
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                let _ = activate_main_window_for(_app);
            }
        });
}
