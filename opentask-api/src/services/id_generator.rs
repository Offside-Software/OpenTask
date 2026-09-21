use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub const EPOCH: i64 = 1767225600000; // 2026-01-01 00:00:00 UTC
pub const WORKER_ID_BITS: u32 = 10;
pub const SEQUENCE_BITS: u32 = 12;

pub const MAX_WORKER_ID: i64 = (1 << WORKER_ID_BITS) - 1;
pub const MAX_SEQUENCE: i64 = (1 << SEQUENCE_BITS) - 1;

pub const WORKER_ID_SHIFT: u32 = SEQUENCE_BITS;
pub const TIMESTAMP_SHIFT: u32 = SEQUENCE_BITS + WORKER_ID_BITS;

pub struct SnowflakeGenerator {
    worker_id: i64,
    sequence: i64,
    last_timestamp: i64,
}

impl SnowflakeGenerator {
    pub const fn new(worker_id: i64) -> Self {
        let valid_worker_id = if worker_id < 0 || worker_id > MAX_WORKER_ID {
            1
        } else {
            worker_id
        };
        Self {
            worker_id: valid_worker_id,
            sequence: 0,
            last_timestamp: -1,
        }
    }

    fn current_timestamp() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("System time before UNIX EPOCH")
            .as_millis() as i64
    }

    pub fn generate(&mut self) -> i64 {
        let mut timestamp = Self::current_timestamp();

        if timestamp < self.last_timestamp {
            // System clock moved backwards
            timestamp = self.last_timestamp;
        }

        if timestamp == self.last_timestamp {
            self.sequence = (self.sequence + 1) & MAX_SEQUENCE;
            if self.sequence == 0 {
                // Sequence exhausted, wait for next millisecond
                while timestamp <= self.last_timestamp {
                    timestamp = Self::current_timestamp();
                }
            }
        } else {
            self.sequence = 0;
        }

        self.last_timestamp = timestamp;

        ((timestamp - EPOCH) << TIMESTAMP_SHIFT)
            | (self.worker_id << WORKER_ID_SHIFT)
            | self.sequence
    }
}

pub static GENERATOR: Mutex<SnowflakeGenerator> = Mutex::new(SnowflakeGenerator::new(1));

pub fn next_id() -> i64 {
    let mut generator = GENERATOR.lock().unwrap();
    generator.generate()
}
