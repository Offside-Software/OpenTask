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

#[derive(Clone)]
pub struct RealtimeHub {
    sender: broadcast::Sender<ProjectEvent>,
}

impl RealtimeHub {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(256);
        Self { sender }
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
}
