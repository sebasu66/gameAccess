use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    thread,
    time::Duration,
};

const BRIDGE_ADDR: &str = "127.0.0.1:1431";
const ALLOWED_ORIGINS: [&str; 2] = ["http://127.0.0.1:1420", "http://localhost:1420"];

pub fn start() -> Result<(), String> {
    let listener = TcpListener::bind(BRIDGE_ADDR)
        .map_err(|err| format!("Could not bind GameAccess local bridge at {BRIDGE_ADDR}: {err}"))?;
    thread::Builder::new()
        .name("gameaccess-local-bridge".into())
        .spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        if let Err(err) = handle_connection(stream) {
                            eprintln!("GameAccess local bridge request failed: {err}");
                        }
                    }
                    Err(err) => eprintln!("GameAccess local bridge accept failed: {err}"),
                }
            }
        })
        .map_err(|err| format!("Could not start GameAccess local bridge thread: {err}"))?;
    Ok(())
}

fn handle_connection(mut stream: TcpStream) -> Result<(), String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|err| err.to_string())?;
    let request = read_request(&mut stream)?;
    let origin_allowed = request
        .origin
        .as_deref()
        .map(|origin| ALLOWED_ORIGINS.contains(&origin))
        .unwrap_or(true);

    if !origin_allowed {
        return write_json(&mut stream, 403, json!({ "error": "Origin not allowed" }), None);
    }

    let response_origin = request.origin.as_deref();
    if request.method == "OPTIONS" {
        return write_empty(&mut stream, 204, response_origin);
    }

    let result = route(&request.method, &request.path, &request.body);
    match result {
        Ok(value) => write_json(&mut stream, 200, value, response_origin),
        Err(RouteError::BadRequest(message)) => {
            write_json(&mut stream, 400, json!({ "error": message }), response_origin)
        }
        Err(RouteError::NotFound) => {
            write_json(&mut stream, 404, json!({ "error": "Not found" }), response_origin)
        }
        Err(RouteError::Internal(message)) => {
            write_json(&mut stream, 500, json!({ "error": message }), response_origin)
        }
    }
}

struct Request {
    method: String,
    path: String,
    origin: Option<String>,
    body: Vec<u8>,
}

fn read_request(stream: &mut TcpStream) -> Result<Request, String> {
    let mut bytes = Vec::with_capacity(4096);
    let mut temp = [0_u8; 4096];
    let mut header_end = None;
    let mut content_length = 0_usize;

    loop {
        let count = stream.read(&mut temp).map_err(|err| err.to_string())?;
        if count == 0 {
            break;
        }
        bytes.extend_from_slice(&temp[..count]);
        if header_end.is_none() {
            if let Some(index) = find_header_end(&bytes) {
                header_end = Some(index);
                let headers = String::from_utf8_lossy(&bytes[..index]);
                content_length = header_value(&headers, "content-length")
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);
            }
        }
        if let Some(index) = header_end {
            if bytes.len() >= index + 4 + content_length {
                break;
            }
        }
        if bytes.len() > 1024 * 1024 {
            return Err("Request too large".into());
        }
    }

    let header_end = header_end.ok_or_else(|| "Malformed HTTP request".to_string())?;
    let headers = String::from_utf8_lossy(&bytes[..header_end]);
    let mut lines = headers.lines();
    let request_line = lines.next().ok_or_else(|| "Missing request line".to_string())?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let raw_path = parts.next().unwrap_or("/");
    let path = raw_path.split('?').next().unwrap_or("/").to_string();
    let origin = header_value(&headers, "origin").map(str::to_string);
    let body_start = header_end + 4;
    let body_end = (body_start + content_length).min(bytes.len());
    let body = bytes[body_start..body_end].to_vec();

    Ok(Request {
        method,
        path,
        origin,
        body,
    })
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n")
}

fn header_value<'a>(headers: &'a str, name: &str) -> Option<&'a str> {
    headers.lines().skip(1).find_map(|line| {
        let (key, value) = line.split_once(':')?;
        if key.trim().eq_ignore_ascii_case(name) {
            Some(value.trim())
        } else {
            None
        }
    })
}

enum RouteError {
    BadRequest(String),
    NotFound,
    Internal(String),
}

fn route(method: &str, path: &str, body: &[u8]) -> Result<Value, RouteError> {
    match (method, path) {
        ("GET", "/health") => Ok(json!({ "ok": true })),
        ("GET", "/local-steam-pool") => super::read_local_steam_pool().map_err(RouteError::Internal),
        ("POST", "/verify-local-steam-inventory") => {
            super::verify_local_steam_inventory().map_err(RouteError::Internal)
        }
        ("GET", "/runtime-prerequisites") => serde_json::to_value(super::runtime_prerequisites())
            .map_err(|err| RouteError::Internal(err.to_string())),
        ("GET", "/steam-installed") => Ok(json!(super::steam_installed())),
        ("GET", "/machine-profile") => serde_json::to_value(super::machine_profile())
            .map_err(|err| RouteError::Internal(err.to_string())),
        ("POST", "/open-steam-client") => {
            super::open_steam_client().map_err(RouteError::Internal)?;
            Ok(json!({ "ok": true }))
        }
        ("POST", "/switch-steam-account") => {
            let value = json_body(body)?;
            let label = string_field(&value, "accountLabel")?;
            serde_json::to_value(super::switch_steam_account(label))
                .map_err(|err| RouteError::Internal(err.to_string()))
        }
        ("POST", "/open-steam-install") => {
            let value = json_body(body)?;
            let app_id = u32_field(&value, "appId")?;
            super::open_steam_install(app_id).map_err(RouteError::Internal)?;
            Ok(json!({ "ok": true }))
        }
        ("POST", "/open-steam-run") => {
            let value = json_body(body)?;
            let app_id = u32_field(&value, "appId")?;
            super::open_steam_run(app_id).map_err(RouteError::Internal)?;
            Ok(json!({ "ok": true }))
        }
        _ => {
            if method == "GET" {
                if let Some(app_id) = path.strip_prefix("/steam-store-metadata/") {
                    let app_id = parse_app_id(app_id)?;
                    return super::steam_store_metadata(app_id).map_err(RouteError::Internal);
                }
                if let Some(app_id) = path.strip_prefix("/steam-download-status/") {
                    let app_id = parse_app_id(app_id)?;
                    return serde_json::to_value(super::steam_download_status(app_id))
                        .map_err(|err| RouteError::Internal(err.to_string()));
                }
            }
            Err(RouteError::NotFound)
        }
    }
}

fn json_body(body: &[u8]) -> Result<Value, RouteError> {
    serde_json::from_slice(body).map_err(|err| RouteError::BadRequest(err.to_string()))
}

fn string_field(value: &Value, name: &str) -> Result<String, RouteError> {
    value
        .get(name)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| RouteError::BadRequest(format!("Missing {name}")))
}

fn u32_field(value: &Value, name: &str) -> Result<u32, RouteError> {
    value
        .get(name)
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .filter(|value| *value > 0)
        .ok_or_else(|| RouteError::BadRequest(format!("Invalid {name}")))
}

fn parse_app_id(value: &str) -> Result<u32, RouteError> {
    value
        .parse::<u32>()
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(|| RouteError::BadRequest("Invalid AppID".into()))
}

fn write_json(
    stream: &mut TcpStream,
    status: u16,
    value: Value,
    origin: Option<&str>,
) -> Result<(), String> {
    let body = serde_json::to_vec(&value).map_err(|err| err.to_string())?;
    write_response(stream, status, "application/json; charset=utf-8", &body, origin)
}

fn write_empty(stream: &mut TcpStream, status: u16, origin: Option<&str>) -> Result<(), String> {
    write_response(stream, status, "text/plain; charset=utf-8", &[], origin)
}

fn write_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &[u8],
    origin: Option<&str>,
) -> Result<(), String> {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        _ => "Internal Server Error",
    };
    let mut headers = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\n",
        body.len()
    );
    if let Some(origin) = origin {
        headers.push_str(&format!("Access-Control-Allow-Origin: {origin}\r\nVary: Origin\r\n"));
    }
    headers.push_str("\r\n");
    stream
        .write_all(headers.as_bytes())
        .and_then(|_| stream.write_all(body))
        .map_err(|err| err.to_string())
}
