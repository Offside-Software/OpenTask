use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectEvent {
    pub version: u8,
    pub project_id: String,
    pub entity: String,
    pub action: String,
    pub entity_id: Option<String>,
}

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct WsTicket {
    pub project_id: i64,
    pub user_id: Option<i64>,
    pub expires_at: Instant,
}

#[derive(Clone)]
pub struct RealtimeHub {
    sender: broadcast::Sender<ProjectEvent>,
    tickets: Arc<RwLock<HashMap<String, WsTicket>>>,
}

impl RealtimeHub {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(256);
        Self {
            sender,
            tickets: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<ProjectEvent> {
        self.sender.subscribe()
    }

    pub fn publish(
        &self,
        project_id: i64,
        entity: &'static str,
        action: &'static str,
        entity_id: Option<i64>,
    ) {
        let _ = self.sender.send(ProjectEvent {
            version: 1,
            project_id: project_id.to_string(),
            entity: entity.to_string(),
            action: action.to_string(),
            entity_id: entity_id.map(|id| id.to_string()),
        });
    }

    pub fn create_ticket(&self, project_id: i64, user_id: Option<i64>, ttl_secs: u64) -> (String, u64) {
        let ticket = format!("wst_{:x}{:x}", rand::random::<u128>(), rand::random::<u128>());
        let expires_at = Instant::now() + Duration::from_secs(ttl_secs);

        if let Ok(mut map) = self.tickets.write() {
            let now = Instant::now();
            map.retain(|_, t| t.expires_at > now);
            map.insert(
                ticket.clone(),
                WsTicket {
                    project_id,
                    user_id,
                    expires_at,
                },
            );
        }

        (ticket, ttl_secs)
    }

    pub fn consume_ticket(&self, ticket_str: &str, expected_project_id: i64) -> Result<WsTicket, &'static str> {
        let mut map = self
            .tickets
            .write()
            .map_err(|_| "Failed to lock ticket store")?;

        let ticket = map
            .remove(ticket_str)
            .ok_or("Ticket not found or already consumed")?;

        if Instant::now() > ticket.expires_at {
            return Err("Ticket has expired");
        }

        if ticket.project_id != expected_project_id {
            return Err("Ticket not valid for this project");
        }

        Ok(ticket)
    }
}

#[cfg(test)]
mod tests {
    use super::ProjectEvent;

    #[test]
    fn serializes_snowflake_ids_as_strings() {
        let event = ProjectEvent {
            version: 1,
            project_id: "101418347630956544".to_string(),
            entity: "task".to_string(),
            action: "updated".to_string(),
            entity_id: Some("101418559460085760".to_string()),
        };

        let value: serde_json::Value = serde_json::to_value(event).unwrap();
        assert_eq!(value["project_id"], "101418347630956544");
        assert_eq!(value["entity_id"], "101418559460085760");
    }

    #[test]
    fn ticket_creation_and_one_time_consumption() {
        let hub = super::RealtimeHub::new();
        let (ticket, expires_in) = hub.create_ticket(101418347630956544, Some(999), 60);
        assert_eq!(expires_in, 60);
        assert!(ticket.starts_with("wst_"));

        // Valid consumption for correct project
        let consumed = hub.consume_ticket(&ticket, 101418347630956544);
        assert!(consumed.is_ok());
        let res = consumed.unwrap();
        assert_eq!(res.project_id, 101418347630956544);
        assert_eq!(res.user_id, Some(999));

        // Replay attempt must fail (one-time use)
        let replay = hub.consume_ticket(&ticket, 101418347630956544);
        assert!(replay.is_err());
    }

    #[test]
    fn ticket_project_mismatch_fails() {
        let hub = super::RealtimeHub::new();
        let (ticket, _) = hub.create_ticket(101418347630956544, None, 60);

        // Consume for wrong project
        let wrong = hub.consume_ticket(&ticket, 999999999999999999);
        assert!(wrong.is_err());
    }
}
