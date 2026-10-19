use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

use super::recall::{self, DownloadError};
use crate::config::get_clean_env;

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone, Debug)]
pub enum MediaStore {
    R2(S3Store),
    Local(LocalStore),
}

#[derive(Clone)]
pub struct S3Store {
    pub endpoint: String,
    pub bucket: String,
    pub region: String,
    pub access_key_id: String,
    secret_access_key: String,
}

impl std::fmt::Debug for S3Store {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("S3Store")
            .field("endpoint", &self.endpoint)
            .field("bucket", &self.bucket)
            .field("region", &self.region)
            .finish_non_exhaustive()
    }
}

#[derive(Clone)]
pub struct LocalStore {
    pub dir: PathBuf,
    secret: [u8; 32],
}

impl std::fmt::Debug for LocalStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LocalStore").field("dir", &self.dir).finish_non_exhaustive()
    }
}

/// Where and how the browser sends the file.
#[derive(Debug, Clone, serde::Serialize)]
pub struct UploadTarget {
    pub url: String,
    pub method: &'static str,
    pub headers: std::collections::BTreeMap<String, String>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum StoreError {
    Failed(String),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::Failed(m) => f.write_str(m),
        }
    }
}

impl MediaStore {
    /// `MEDIA_STORAGE` = `r2` | `local` | `off`. Unset: R2
    pub fn from_env() -> Option<MediaStore> {
        let mode = get_clean_env("MEDIA_STORAGE").map(|m| m.to_ascii_lowercase());
        if mode.as_deref() == Some("off") {
            return None;
        }
        let r2 = S3Store::from_env();
        match (mode.as_deref(), r2) {
            (Some("local"), _) => Some(MediaStore::Local(LocalStore::from_env())),
            (_, Some(store)) => Some(MediaStore::R2(store)),
            (Some("r2"), None) => {
                tracing::warn!(
                    "[Meeting Pipeline] MEDIA_STORAGE=r2 but R2_ACCOUNT_ID (or R2_ENDPOINT), R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are not all set; recording uploads are off"
                );
                None
            }
            _ if cfg!(debug_assertions) => Some(MediaStore::Local(LocalStore::from_env())),
            _ => None,
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            MediaStore::R2(_) => "R2",
            MediaStore::Local(_) => "local folder",
        }
    }

    pub fn presign_put(&self, key: &str, content_type: &str, expires: Duration) -> UploadTarget {
        let now = Utc::now();
        let mut headers = std::collections::BTreeMap::new();
        headers.insert("Content-Type".to_string(), content_type.to_string());
        let url = match self {
            MediaStore::R2(s3) => s3.presign("PUT", key, now, expires.as_secs()),
            MediaStore::Local(local) => local.upload_url(key, now.timestamp() + expires.as_secs() as i64),
        };
        UploadTarget { url, method: "PUT", headers, expires_at: now + chrono::Duration::seconds(expires.as_secs() as i64) }
    }

    /// The stored object's size, or `None` when it is not there.
    pub async fn size(&self, key: &str) -> Result<Option<u64>, StoreError> {
        match self {
            MediaStore::R2(s3) => {
                let url = s3.presign("HEAD", key, Utc::now(), 300);
                let resp = client(30)
                    .head(url)
                    .send()
                    .await
                    .map_err(|e| StoreError::Failed(format!("could not reach R2: {}", e.without_url())))?;
                match resp.status().as_u16() {
                    // The header, not `content_length()`: a HEAD response has no body, so reqwest reports 0.
                    200 => Ok(resp
                        .headers()
                        .get(reqwest::header::CONTENT_LENGTH)
                        .and_then(|v| v.to_str().ok())
                        .and_then(|v| v.parse::<u64>().ok())),
                    404 => Ok(None),
                    status => Err(StoreError::Failed(format!("R2 answered {status} for the upload"))),
                }
            }
            MediaStore::Local(local) => {
                let Some(path) = local.path_for(key) else { return Ok(None) };
                match tokio::fs::metadata(&path).await {
                    Ok(meta) => Ok(Some(meta.len())),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
                    Err(e) => Err(StoreError::Failed(format!("could not read the upload: {e}"))),
                }
            }
        }
    }

    /// Copies the object to `path`, refusing more than `max_bytes`.
    pub async fn download(&self, key: &str, path: &Path, max_bytes: u64) -> Result<u64, DownloadError> {
        match self {
            MediaStore::R2(s3) => recall::download_to_file(&s3.presign("GET", key, Utc::now(), 900), path, max_bytes).await,
            MediaStore::Local(local) => {
                let source = local
                    .path_for(key)
                    .ok_or_else(|| DownloadError::Failed(format!("invalid storage key {key}")))?;
                let size = tokio::fs::metadata(&source)
                    .await
                    .map_err(|e| DownloadError::Failed(format!("the upload is missing: {e}")))?
                    .len();
                if size > max_bytes {
                    return Err(DownloadError::TooLarge(format!(
                        "the recording is larger than {} MB",
                        max_bytes / (1024 * 1024)
                    )));
                }
                tokio::fs::copy(&source, path)
                    .await
                    .map_err(|e| DownloadError::Failed(format!("could not copy the upload: {e}")))
            }
        }
    }

    /// Removes the object; one that is already gone counts as removed.
    pub async fn delete(&self, key: &str) -> Result<(), StoreError> {
        match self {
            MediaStore::R2(s3) => {
                let url = s3.presign("DELETE", key, Utc::now(), 300);
                let resp = client(30)
                    .delete(url)
                    .send()
                    .await
                    .map_err(|e| StoreError::Failed(format!("could not reach R2: {}", e.without_url())))?;
                match resp.status().as_u16() {
                    200..=299 | 404 => Ok(()),
                    status => Err(StoreError::Failed(format!("R2 answered {status} when deleting the upload"))),
                }
            }
            MediaStore::Local(local) => {
                let Some(path) = local.path_for(key) else { return Ok(()) };
                match tokio::fs::remove_file(&path).await {
                    Ok(()) => Ok(()),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                    Err(e) => Err(StoreError::Failed(format!("could not delete the upload: {e}"))),
                }
            }
        }
    }
}

fn client(timeout_secs: u64) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

impl S3Store {
    fn from_env() -> Option<S3Store> {
        let endpoint = get_clean_env("R2_ENDPOINT")
            .or_else(|| get_clean_env("R2_ACCOUNT_ID").map(|id| format!("https://{id}.r2.cloudflarestorage.com")))?;
        Some(S3Store {
            endpoint: endpoint.trim_end_matches('/').to_string(),
            bucket: get_clean_env("R2_BUCKET")?,
            region: get_clean_env("R2_REGION").unwrap_or_else(|| "auto".to_string()),
            access_key_id: get_clean_env("R2_ACCESS_KEY_ID")?,
            secret_access_key: get_clean_env("R2_SECRET_ACCESS_KEY")?,
        })
    }

    #[cfg(test)]
    pub fn new(endpoint: &str, bucket: &str, region: &str, access_key_id: &str, secret_access_key: &str) -> S3Store {
        S3Store {
            endpoint: endpoint.to_string(),
            bucket: bucket.to_string(),
            region: region.to_string(),
            access_key_id: access_key_id.to_string(),
            secret_access_key: secret_access_key.to_string(),
        }
    }

    fn presign(&self, method: &str, key: &str, now: DateTime<Utc>, expires_secs: u64) -> String {
        presign_url(
            method,
            &self.endpoint,
            &format!("/{}/{}", self.bucket, key),
            &self.region,
            &self.access_key_id,
            &self.secret_access_key,
            now,
            expires_secs,
        )
    }
}

/// RFC 3986 encoding as SigV4 wants it; `/` is kept in paths and encoded in query values.
fn uri_encode(input: &str, encode_slash: bool) -> String {
    let mut out = String::with_capacity(input.len());
    for b in input.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            b'/' if !encode_slash => out.push('/'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn hmac(key: &[u8], data: &str) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC takes keys of any length");
    mac.update(data.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

/// An AWS Signature V4 query-string presigned URL (only `host` is signed, payload unsigned).
#[allow(clippy::too_many_arguments)]
pub fn presign_url(
    method: &str,
    endpoint: &str,
    path: &str,
    region: &str,
    access_key_id: &str,
    secret_access_key: &str,
    now: DateTime<Utc>,
    expires_secs: u64,
) -> String {
    let host = endpoint.split_once("://").map(|(_, rest)| rest).unwrap_or(endpoint);
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date = now.format("%Y%m%d").to_string();
    let scope = format!("{date}/{region}/s3/aws4_request");
    let canonical_uri = uri_encode(path, false);
    // Already in byte order, as the canonical query must be.
    let params = [
        ("X-Amz-Algorithm", "AWS4-HMAC-SHA256".to_string()),
        ("X-Amz-Credential", format!("{access_key_id}/{scope}")),
        ("X-Amz-Date", amz_date.clone()),
        ("X-Amz-Expires", expires_secs.to_string()),
        ("X-Amz-SignedHeaders", "host".to_string()),
    ];
    let query = params
        .iter()
        .map(|(k, v)| format!("{}={}", uri_encode(k, true), uri_encode(v, true)))
        .collect::<Vec<_>>()
        .join("&");
    let canonical_request = format!("{method}\n{canonical_uri}\n{query}\nhost:{host}\n\nhost\nUNSIGNED-PAYLOAD");
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
        hex::encode(Sha256::digest(canonical_request.as_bytes()))
    );
    let key = hmac(&hmac(&hmac(&hmac(format!("AWS4{secret_access_key}").as_bytes(), &date), region), "s3"), "aws4_request");
    let signature = hex::encode(hmac(&key, &string_to_sign));
    format!("{endpoint}{canonical_uri}?{query}&X-Amz-Signature={signature}")
}

impl LocalStore {
    fn from_env() -> LocalStore {
        let dir = get_clean_env("MEDIA_LOCAL_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::temp_dir().join("opentask-media"));
        LocalStore::new(dir)
    }

    pub fn new(dir: PathBuf) -> LocalStore {
        LocalStore { dir, secret: rand::random::<[u8; 32]>() }
    }

    fn signature(&self, key: &str, expires: i64) -> String {
        hex::encode(hmac(&self.secret, &format!("PUT\n{key}\n{expires}")))
    }

    fn upload_url(&self, key: &str, expires: i64) -> String {
        format!(
            "/meeting-uploads?key={}&expires={expires}&sig={}",
            uri_encode(key, true),
            self.signature(key, expires)
        )
    }

    /// Checks an upload URL's signature and expiry.
    pub fn verify(&self, key: &str, expires: i64, signature: &str, now: DateTime<Utc>) -> bool {
        if expires < now.timestamp() {
            return false;
        }
        let Ok(signature) = hex::decode(signature) else { return false };
        let mut mac = HmacSha256::new_from_slice(&self.secret).expect("HMAC takes keys of any length");
        mac.update(format!("PUT\n{key}\n{expires}").as_bytes());
        mac.verify_slice(&signature).is_ok()
    }

    /// Streams an upload to its file, refusing more than `limit` bytes. Written to a `.part` file first, so a broken upload never looks complete.
    pub async fn receive<S, E>(&self, key: &str, mut body: S, limit: u64) -> Result<u64, String>
    where
        S: futures_util::Stream<Item = Result<axum::body::Bytes, E>> + Unpin,
        E: std::fmt::Display,
    {
        use futures_util::StreamExt;
        use tokio::io::AsyncWriteExt;

        let path = self.path_for(key).ok_or_else(|| "invalid upload key".to_string())?;
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| format!("could not create the upload folder: {e}"))?;
        }
        let partial = path.with_extension("part");
        let result = async {
            let mut file = tokio::fs::File::create(&partial).await.map_err(|e| format!("could not store the upload: {e}"))?;
            let mut written = 0u64;
            while let Some(chunk) = body.next().await {
                let chunk = chunk.map_err(|e| format!("the upload broke off: {e}"))?;
                written += chunk.len() as u64;
                if written > limit {
                    return Err(format!("uploads are limited to {} MB", limit / (1024 * 1024)));
                }
                file.write_all(&chunk).await.map_err(|e| format!("could not store the upload: {e}"))?;
            }
            file.flush().await.map_err(|e| format!("could not store the upload: {e}"))?;
            Ok(written)
        }
        .await;
        match result {
            Ok(written) => {
                tokio::fs::rename(&partial, &path).await.map_err(|e| format!("could not store the upload: {e}"))?;
                Ok(written)
            }
            Err(e) => {
                let _ = tokio::fs::remove_file(&partial).await;
                Err(e)
            }
        }
    }

    /// The file for a storage key; keys are generated by us, so anything unusual is refused.
    pub fn path_for(&self, key: &str) -> Option<PathBuf> {
        let ok = !key.is_empty()
            && key.split('/').all(|part| !part.is_empty() && part != "." && part != "..")
            && key.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'.' | b'-' | b'_'));
        ok.then(|| self.dir.join(key))
    }
}

/// `ingest/<project>/<job>/source.<ext>`, the extension taken from the file name when it is a known audio or video one.
pub fn upload_key(project_id: i64, job_id: i64, file_name: &str) -> String {
    const KNOWN: [&str; 14] = ["ogg", "opus", "webm", "mp3", "m4a", "aac", "wav", "flac", "mp4", "mov", "mkv", "avi", "3gp", "oga"];
    let ext = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .filter(|e| KNOWN.contains(&e.as_str()))
        .unwrap_or_else(|| "bin".to_string());
    format!("ingest/{project_id}/{job_id}/source.{ext}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_aws_presigned_url_example() {
        // "Authenticating Requests: Using Query Parameters (AWS Signature Version 4)", example GET.
        let url = presign_url(
            "GET",
            "https://examplebucket.s3.amazonaws.com",
            "/test.txt",
            "us-east-1",
            "AKIAIOSFODNN7EXAMPLE",
            "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            "2013-05-24T00:00:00Z".parse().unwrap(),
            86400,
        );
        assert_eq!(
            url,
            "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256\
             &X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request\
             &X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host\
             &X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"
        );
    }

    #[test]
    fn r2_urls_are_path_style_with_the_auto_region() {
        let store = S3Store::new("https://acct.r2.cloudflarestorage.com", "opentask-media", "auto", "key", "secret");
        let url = store.presign("PUT", "ingest/1/2/source.ogg", "2026-10-20T08:00:00Z".parse().unwrap(), 3600);
        assert!(url.starts_with("https://acct.r2.cloudflarestorage.com/opentask-media/ingest/1/2/source.ogg?"));
        assert!(url.contains("%2Fauto%2Fs3%2Faws4_request"));
        assert!(url.contains("X-Amz-Expires=3600"));
    }

    #[test]
    fn local_upload_urls_are_signed_and_expire() {
        let store = LocalStore::new(std::env::temp_dir());
        let now: DateTime<Utc> = "2026-10-20T08:00:00Z".parse().unwrap();
        let expires = now.timestamp() + 60;
        let signature = store.signature("ingest/1/2/source.ogg", expires);
        assert!(store.verify("ingest/1/2/source.ogg", expires, &signature, now));
        assert!(!store.verify("ingest/1/3/source.ogg", expires, &signature, now), "another key");
        assert!(!store.verify("ingest/1/2/source.ogg", expires, &signature, now + chrono::Duration::seconds(61)), "expired");
        assert!(!store.verify("ingest/1/2/source.ogg", expires, "zz", now));
        assert!(store.upload_url("ingest/1/2/source.ogg", expires).starts_with("/meeting-uploads?key=ingest%2F1%2F2%2Fsource.ogg&expires="));
    }

    #[test]
    fn local_paths_refuse_odd_keys() {
        let store = LocalStore::new(PathBuf::from("/data"));
        assert!(store.path_for("ingest/1/2/source.ogg").is_some());
        for bad in ["../etc/passwd", "ingest//x", "ingest/1/../../x", "", "ingest/1/2/a b.ogg", "C:\\x"] {
            assert!(store.path_for(bad).is_none(), "{bad}");
        }
    }

    #[tokio::test]
    async fn local_uploads_stream_to_disk_within_the_limit() {
        let dir = std::env::temp_dir().join(format!("opentask-store-test-{}", rand::random::<u64>()));
        let store = LocalStore::new(dir.clone());
        let chunks = |parts: Vec<&'static [u8]>| {
            futures_util::stream::iter(parts.into_iter().map(|p| Ok::<_, std::io::Error>(axum::body::Bytes::from_static(p))))
        };

        let written = store.receive("ingest/1/2/source.ogg", chunks(vec![b"abc", b"defg"]), 10).await.unwrap();
        assert_eq!(written, 7);
        assert_eq!(std::fs::read(dir.join("ingest/1/2/source.ogg")).unwrap(), b"abcdefg");

        let too_big = store.receive("ingest/1/3/source.ogg", chunks(vec![b"abcdef", b"ghijkl"]), 10).await;
        assert!(too_big.unwrap_err().contains("limited"));
        assert!(!dir.join("ingest/1/3/source.ogg").exists());
        assert!(!dir.join("ingest/1/3/source.part").exists(), "no partial file is left");

        let broken = futures_util::stream::iter(vec![
            Ok(axum::body::Bytes::from_static(b"abc")),
            Err(std::io::Error::other("connection reset")),
        ]);
        assert!(store.receive("ingest/1/4/source.ogg", broken, 10).await.unwrap_err().contains("broke off"));
        assert!(!dir.join("ingest/1/4/source.ogg").exists());
        assert!(store.receive("../escape", chunks(vec![b"x"]), 10).await.is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn upload_keys_keep_known_extensions_only() {
        assert_eq!(upload_key(1, 2, "Rapat Senin.MP4"), "ingest/1/2/source.mp4");
        assert_eq!(upload_key(1, 2, "audio.ogg"), "ingest/1/2/source.ogg");
        assert_eq!(upload_key(1, 2, "notes.exe"), "ingest/1/2/source.bin");
        assert_eq!(upload_key(1, 2, "no-extension"), "ingest/1/2/source.bin");
    }
}
