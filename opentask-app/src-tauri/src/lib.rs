use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;
use tauri::{AppHandle, Manager};

fn extract_token_from_request(req: &str) -> Option<String> {
    let first_line = req.lines().next()?;
    let path = first_line.split_whitespace().nth(1)?;
    let query_str = path.split_once('?')?.1;
    for pair in query_str.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if k == "token" && !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}

#[tauri::command]
async fn start_desktop_oauth(app: AppHandle, auth_url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|e| format!("Failed to bind loopback address: {e}"))?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        listener.set_nonblocking(false).map_err(|e| e.to_string())?;

        let callback_url = format!("http://localhost:{port}/callback");
        let sep = if auth_url.contains('?') { "&" } else { "?" };
        let full_auth_url = format!("{auth_url}{sep}return_to={callback_url}");

        // Open the user's default browser
        if let Err(e) = open::that(&full_auth_url) {
            log::warn!("Could not open browser with open::that: {e}");
        }

        // Wait up to 180 seconds for callback
        let start = std::time::Instant::now();
        for stream in listener.incoming() {
            if start.elapsed() > Duration::from_secs(180) {
                return Err("Authentication timed out after 3 minutes".to_string());
            }

            match stream {
                Ok(mut s) => {
                    let _ = s.set_read_timeout(Some(Duration::from_secs(10)));
                    let mut buffer = [0u8; 4096];
                    let n = s.read(&mut buffer).unwrap_or(0);
                    let request = String::from_utf8_lossy(&buffer[..n]);

                    if let Some(token) = extract_token_from_request(&request) {
                        let html_response = concat!(
                            "HTTP/1.1 200 OK\r\n",
                            "Content-Type: text/html; charset=utf-8\r\n",
                            "Connection: close\r\n\r\n",
                            "<!DOCTYPE html>",
                            "<html>",
                            "<head>",
                            "<meta charset='utf-8'>",
                            "<title>OpenTask Desktop - Signed In</title>",
                            "<style>",
                            "body { background: #0E1012; color: #FFFFFF; font-family: -apple-system, BlinkMacSystemFont, monospace; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }",
                            ".card { background: #141619; border: 3px solid #000; box-shadow: 6px 6px 0px #000; padding: 36px 28px; max-width: 440px; width: 100%; text-align: center; }",
                            ".badge { background: #00FF66; color: #000; font-weight: 900; font-size: 11px; padding: 4px 10px; display: inline-block; margin-bottom: 16px; border: 2px solid #000; letter-spacing: 1px; }",
                            "h1 { color: #FFE600; font-size: 18px; letter-spacing: 2px; text-transform: uppercase; margin: 0 0 10px; }",
                            "p { color: #A3A3A3; font-size: 13px; line-height: 1.6; margin: 0; }",
                            "</style>",
                            "</head>",
                            "<body>",
                            "<div class='card'>",
                            "<div class='badge'>AUTHENTICATION COMPLETE</div>",
                            "<h1>OpenTask Desktop</h1>",
                            "<p>You have successfully authenticated via GitHub in your browser.<br>You can now close this tab and return to OpenTask.</p>",
                            "</div>",
                            "</body>",
                            "</html>"
                        );
                        let _ = s.write_all(html_response.as_bytes());
                        let _ = s.flush();

                        // Bring OpenTask to front
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }

                        return Ok(token);
                    } else if request.contains("favicon.ico") {
                        let not_found = "HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n";
                        let _ = s.write_all(not_found.as_bytes());
                    }
                }
                Err(e) => {
                    log::warn!("Loopback accept error: {e}");
                }
            }
        }

        Err("Desktop OAuth listener closed".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![start_desktop_oauth]);

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            #[cfg(desktop)]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
