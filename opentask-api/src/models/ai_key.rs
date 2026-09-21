use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct TestKeyRequest {
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestKeyResponse {
    pub valid: bool,
    pub message: Option<String>,
    pub error: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SetApiKeyRequest {
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApiKeyStatusResponse {
    pub has_key: bool,
    pub masked_key: Option<String>,
    pub source: String,
}
