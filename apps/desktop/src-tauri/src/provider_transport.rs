use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rand::rngs::OsRng;
use reqwest::Url;
use rsa::{pkcs8::EncodePublicKey, Oaep, RsaPrivateKey, RsaPublicKey};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::time::Duration;

const TRANSPORT_ALGORITHM: &str = "RSA-OAEP-256+A256GCM";
const TRANSPORT_CONTEXT: &str = "gameaccess-provider-login-v1";

#[derive(Serialize)]
struct CredentialTransportRequest {
    client_public_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CredentialEnvelope {
    alg: String,
    encrypted_key: String,
    nonce: String,
    ciphertext: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderCredentials {
    #[serde(default)]
    pub(crate) provider_id: Option<String>,
    pub(crate) account_name: String,
    pub(crate) password: String,
    pub(crate) expected_user_id32: u32,
}

#[derive(Deserialize)]
struct ErrorResponse {
    detail: Option<String>,
}

fn transport_aad(lease_id: i64, installation_id: &str) -> Vec<u8> {
    format!("{TRANSPORT_CONTEXT}|{lease_id}|{installation_id}").into_bytes()
}

fn download_transport_aad(app_id: u32, installation_id: &str) -> Vec<u8> {
    format!("gameaccess-provider-download-v1|{app_id}|{installation_id}").into_bytes()
}

fn transport_url(api_base_url: &str, path: &str) -> Result<Url, String> {
    let base = Url::parse(api_base_url.trim())
        .map_err(|_| "The GameAccess server URL is invalid".to_string())?;
    let host = base.host_str().unwrap_or_default();
    let local_http = matches!(host, "127.0.0.1" | "localhost" | "::1");
    if base.scheme() != "https" && !local_http {
        return Err("Remote provider credential transport requires HTTPS".into());
    }
    base.join(path)
        .map_err(|_| "Could not build the provider credential URL".to_string())
}

fn credential_url(api_base_url: &str, lease_id: i64) -> Result<Url, String> {
    if lease_id <= 0 {
        return Err("Invalid GameAccess lease".into());
    }
    transport_url(api_base_url, &format!("/leases/{lease_id}/steam-login"))
}

fn download_credential_url(api_base_url: &str, app_id: u32) -> Result<Url, String> {
    if app_id == 0 {
        return Err("Invalid Steam AppID".into());
    }
    transport_url(api_base_url, &format!("/downloads/{app_id}/steam-login"))
}

fn decrypt_envelope(
    private_key: &RsaPrivateKey,
    envelope: CredentialEnvelope,
    aad: &[u8],
) -> Result<ProviderCredentials, String> {
    if envelope.alg != TRANSPORT_ALGORITHM {
        return Err("Unsupported provider credential transport".into());
    }
    let encrypted_key = STANDARD
        .decode(envelope.encrypted_key)
        .map_err(|_| "Provider credential key envelope is invalid".to_string())?;
    let data_key = private_key
        .decrypt(Oaep::new::<Sha256>(), &encrypted_key)
        .map_err(|_| "Provider credential key could not be decrypted".to_string())?;
    if data_key.len() != 32 {
        return Err("Provider credential key has an invalid size".into());
    }
    let nonce = STANDARD
        .decode(envelope.nonce)
        .map_err(|_| "Provider credential nonce is invalid".to_string())?;
    if nonce.len() != 12 {
        return Err("Provider credential nonce has an invalid size".into());
    }
    let ciphertext = STANDARD
        .decode(envelope.ciphertext)
        .map_err(|_| "Provider credential payload is invalid".to_string())?;
    let cipher = Aes256Gcm::new_from_slice(&data_key)
        .map_err(|_| "Provider credential key could not be initialized".to_string())?;
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad,
            },
        )
        .map_err(|_| "Provider credential payload could not be decrypted".to_string())?;
    let credentials: ProviderCredentials = serde_json::from_slice(&plaintext)
        .map_err(|_| "Provider credential payload is malformed".to_string())?;
    if credentials.account_name.trim().is_empty()
        || credentials.password.is_empty()
        || credentials.expected_user_id32 == 0
    {
        return Err("Provider credential payload is incomplete".into());
    }
    Ok(credentials)
}

fn fetch_encrypted_credentials(url: Url, aad: Vec<u8>) -> Result<ProviderCredentials, String> {
    let session_token = crate::access_activation::read_session()?
        .ok_or_else(|| "GameAccess activation session is unavailable".to_string())?;
    let installation_id = crate::access_activation::installation_id()?;

    let mut rng = OsRng;
    let private_key = RsaPrivateKey::new(&mut rng, 2048)
        .map_err(|_| "Could not create the provider credential transport key".to_string())?;
    let public_key = RsaPublicKey::from(&private_key);
    let public_der = public_key
        .to_public_key_der()
        .map_err(|_| "Could not encode the provider credential transport key".to_string())?;
    let request = CredentialTransportRequest {
        client_public_key: STANDARD.encode(public_der.as_bytes()),
    };

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "Could not initialize provider credential transport".to_string())?;
    let response = client
        .post(url)
        .bearer_auth(&session_token)
        .header("X-GameAccess-Installation", &installation_id)
        .header("Cache-Control", "no-store")
        .json(&request)
        .send()
        .map_err(|err| {
            let mut detail = err.to_string();
            let mut source = std::error::Error::source(&err);
            while let Some(cause) = source {
                detail.push_str(": ");
                detail.push_str(&cause.to_string());
                source = cause.source();
            }
            format!("Provider credential request failed: {detail}")
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let detail = response
            .json::<ErrorResponse>()
            .ok()
            .and_then(|body| body.detail)
            .unwrap_or_else(|| "Provider credential request was rejected".to_string());
        return Err(format!("{status} {detail}"));
    }

    let envelope = response
        .json::<CredentialEnvelope>()
        .map_err(|_| "Provider credential response is malformed".to_string())?;
    decrypt_envelope(&private_key, envelope, &aad)
}

fn fetch_provider_credentials(
    api_base_url: String,
    lease_id: i64,
) -> Result<ProviderCredentials, String> {
    let installation_id = crate::access_activation::installation_id()?;
    let url = credential_url(&api_base_url, lease_id)?;
    fetch_encrypted_credentials(url, transport_aad(lease_id, &installation_id))
}

pub(crate) fn fetch_provider_download_credentials(
    api_base_url: String,
    app_id: u32,
) -> Result<ProviderCredentials, String> {
    let installation_id = crate::access_activation::installation_id()?;
    let url = download_credential_url(&api_base_url, app_id)?;
    fetch_encrypted_credentials(url, download_transport_aad(app_id, &installation_id))
}

#[tauri::command]
pub async fn login_provider_steam_for_lease(
    api_base_url: String,
    lease_id: i64,
) -> Result<(), String> {
    let credentials = tauri::async_runtime::spawn_blocking(move || {
        fetch_provider_credentials(api_base_url, lease_id)
    })
    .await
    .map_err(|_| "Provider credential transport task failed".to_string())??;

    crate::steam_session::login_provider_steam(
        credentials.account_name,
        credentials.password,
        credentials.expected_user_id32,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_plain_http_for_remote_servers() {
        assert!(credential_url("http://example.com", 7).is_err());
        assert!(credential_url("http://127.0.0.1:8000", 7).is_ok());
        assert!(credential_url("https://example.com", 7).is_ok());
    }

    #[test]
    fn decrypts_hybrid_provider_envelope() {
        let mut rng = OsRng;
        let private_key = RsaPrivateKey::new(&mut rng, 2048).unwrap();
        let public_key = RsaPublicKey::from(&private_key);
        let data_key = [7_u8; 32];
        let nonce = [3_u8; 12];
        let aad = transport_aad(42, "install-1");
        let plaintext = br#"{"accountName":"provider","password":"secret","expectedUserId32":123}"#;
        let cipher = Aes256Gcm::new_from_slice(&data_key).unwrap();
        let ciphertext = cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: plaintext,
                    aad: &aad,
                },
            )
            .unwrap();
        let encrypted_key = public_key
            .encrypt(&mut rng, Oaep::new::<Sha256>(), &data_key)
            .unwrap();
        let envelope = CredentialEnvelope {
            alg: TRANSPORT_ALGORITHM.to_string(),
            encrypted_key: STANDARD.encode(encrypted_key),
            nonce: STANDARD.encode(nonce),
            ciphertext: STANDARD.encode(ciphertext),
        };
        let credentials = decrypt_envelope(&private_key, envelope, &aad).unwrap();
        assert_eq!(credentials.account_name, "provider");
        assert_eq!(credentials.password, "secret");
        assert_eq!(credentials.expected_user_id32, 123);
    }
}
