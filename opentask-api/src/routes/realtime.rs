use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    response::Response,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;

use crate::{
    error::AppError,
    extractors::auth::resolve_github_user,
    models::safe_id::SafeId,
    routes::auth::AppState,
};

#[derive(Debug, Deserialize)]
pub struct WebSocketAuth {
    pub token: String,
}

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/projects/{project_id}/events",
        get(project_events),
    )
}

async fn project_events(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
    Query(auth): Query<WebSocketAuth>,
    ws: WebSocketUpgrade,
) -> Result<Response, AppError> {
    let github_user = resolve_github_user(&auth.token).await?;
    let is_member = crate::db::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM opentask.project_member pm
            JOIN opentask.users u ON u.id = pm.user_id
            WHERE pm.project_id = $1
              AND (u.gh_id = $2 OR u.gh_username = $3)
        );
        "#,
    )
    .bind(project_id.0)
    .bind(github_user.id.to_string())
    .bind(&github_user.login)
    .fetch_one(&state.pool)
    .await?;

    if !is_member {
        return Err(AppError::Forbidden(
            "You are not a member of this project".to_string(),
        ));
    }

    let receiver = state.realtime.subscribe();
    Ok(ws.on_upgrade(move |socket| stream_project_events(socket, project_id.0, receiver)))
}

async fn stream_project_events(
    socket: WebSocket,
    project_id: i64,
    mut receiver: tokio::sync::broadcast::Receiver<crate::services::realtime::ProjectEvent>,
) {
    let (mut sender, mut incoming) = socket.split();
    loop {
        tokio::select! {
            event = receiver.recv() => {
                match event {
                    Ok(event) if event.project_id == project_id.to_string() => {
                        match serde_json::to_string(&event) {
                            Ok(payload) => {
                                if sender.send(Message::Text(payload.into())).await.is_err() {
                                    break;
                                }
                            }
                            Err(error) => {
                                tracing::error!("Failed to serialize project event: {error}");
                                break;
                            }
                        }
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        let _ = sender.send(Message::Ping(Vec::new().into())).await;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            message = incoming.next() => {
                match message {
                    Some(Ok(Message::Ping(payload))) => {
                        if sender.send(Message::Pong(payload)).await.is_err() { break; }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
        }
    }
}
