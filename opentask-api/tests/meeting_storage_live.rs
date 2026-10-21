//! Live checks against the real R2 bucket and Cloudflare Workers AI, using the keys in `.env`.
//! Ignored by default; run with `cargo test --test meeting_storage_live -- --ignored --nocapture`.
//! They create one small object (removed again) and transcribe a few seconds of audio.

use opentask_api::config::Config;
use opentask_api::services::id_generator::next_id;
use opentask_api::services::meeting_pipeline::cf_whisper::CfWhisper;
use opentask_api::services::meeting_pipeline::config::PipelineConfig;
use opentask_api::services::meeting_pipeline::storage::MediaStore;

/// A few seconds of 16 kHz mono PCM WAV (a tone), when no `LIVE_AUDIO_FILE` is given.
fn tone_wav(seconds: u32) -> Vec<u8> {
    let rate = 16_000u32;
    let samples = rate * seconds;
    let mut wav = Vec::with_capacity(44 + samples as usize * 2);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + samples * 2).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&rate.to_le_bytes());
    wav.extend_from_slice(&(rate * 2).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(samples * 2).to_le_bytes());
    for i in 0..samples {
        let value = ((i as f32 * 440.0 * std::f32::consts::TAU / rate as f32).sin() * 8_000.0) as i16;
        wav.extend_from_slice(&value.to_le_bytes());
    }
    wav
}

#[tokio::test]
#[ignore]
async fn r2_accepts_presigned_uploads() {
    let _config = Config::load();
    let store = MediaStore::from_env().expect("no media store configured");
    assert_eq!(store.kind(), "R2", "R2_* variables are not all set, so the local folder would be used");

    let key = format!("ingest/live-test/{}/probe.wav", next_id());
    let body = tone_wav(2);

    // What the browser does: PUT to the presigned URL with the given headers.
    let target = store.presign_put(&key, "audio/wav", std::time::Duration::from_secs(300));
    let mut request = reqwest::Client::new().put(&target.url).body(body.clone());
    for (name, value) in &target.headers {
        request = request.header(name, value);
    }
    let response = request.send().await.expect("could not reach R2");
    let status = response.status();
    let detail = response.text().await.unwrap_or_default();
    assert!(status.is_success(), "R2 refused the presigned PUT: {status} {}", detail.chars().take(300).collect::<String>());
    println!("PUT via presigned URL: {status}");

    // What `complete` and the worker do: check the size, download, then delete.
    let size = store.size(&key).await.expect("HEAD failed");
    assert_eq!(size, Some(body.len() as u64));
    println!("HEAD: {} bytes", body.len());

    let path = std::env::temp_dir().join(format!("opentask-r2-live-{}.wav", next_id()));
    let downloaded = store.download(&key, &path, 10 * 1024 * 1024).await.expect("download failed");
    assert_eq!(std::fs::read(&path).unwrap(), body);
    let _ = std::fs::remove_file(&path);
    println!("GET via presigned URL: {downloaded} bytes, identical");

    store.delete(&key).await.expect("delete failed");
    assert_eq!(store.size(&key).await.unwrap(), None, "the object is still there after DELETE");
    println!("DELETE: gone");
}

#[tokio::test]
#[ignore]
async fn cloudflare_whisper_transcribes() {
    let _config = Config::load();
    let cfg = PipelineConfig::from_env();
    let cf = CfWhisper {
        base_url: &cfg.cf_api_base,
        account_id: cfg.cf_account_id.as_deref().expect("CLOUDFLARE_ACCOUNT_ID is not set"),
        api_token: cfg.cf_api_token.as_deref().expect("CLOUDFLARE_API_TOKEN is not set"),
        model: cfg.cf_asr_model,
        project_id: None,
    };
    let (path, cleanup) = match std::env::var("LIVE_AUDIO_FILE") {
        Ok(file) => (std::path::PathBuf::from(file), false),
        Err(_) => {
            let path = std::env::temp_dir().join(format!("opentask-cf-live-{}.wav", next_id()));
            std::fs::write(&path, tone_wav(3)).unwrap();
            (path, true)
        }
    };
    let language = std::env::var("LIVE_AUDIO_LANGUAGE").ok();
    let result = cf.transcribe(&path, language.as_deref(), None, 0.0).await;
    if cleanup {
        let _ = std::fs::remove_file(&path);
    }
    let response = result.unwrap_or_else(|e| panic!("Workers AI Whisper failed: {e:?}"));
    println!("language: {:?}, duration: {:?}", response.language, response.duration);
    for s in &response.segments {
        println!("[{:>6.1}-{:>6.1}] {}", s.start, s.end, s.text.trim());
    }
}
