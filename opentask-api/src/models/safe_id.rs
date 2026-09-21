use serde::{de, Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;
use std::ops::Deref;
use std::str::FromStr;

/// SafeId wraps an `i64` Snowflake ID.
///
/// Crucial JavaScript Precision Rule:
/// In JSON serialization, `SafeId` always formats as a string (e.g. `"94695191667019776"`).
/// This prevents JavaScript `Number.MAX_SAFE_INTEGER` precision truncation in browsers.
///
/// In deserialization, `SafeId` accepts both string and integer representations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, sqlx::Type)]
#[sqlx(transparent)]
pub struct SafeId(pub i64);

impl SafeId {
    pub fn new(id: i64) -> Self {
        Self(id)
    }

    pub fn inner(&self) -> i64 {
        self.0
    }
}

impl Deref for SafeId {
    type Target = i64;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl From<i64> for SafeId {
    fn from(v: i64) -> Self {
        Self(v)
    }
}

impl From<SafeId> for i64 {
    fn from(s: SafeId) -> Self {
        s.0
    }
}

impl fmt::Display for SafeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl FromStr for SafeId {
    type Err = std::num::ParseIntError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let val = s.trim().parse::<i64>()?;
        Ok(Self(val))
    }
}

impl Serialize for SafeId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.0.to_string())
    }
}

impl<'de> Deserialize<'de> for SafeId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct SafeIdVisitor;

        impl<'de> de::Visitor<'de> for SafeIdVisitor {
            type Value = SafeId;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a snowflake id as an integer or numeric string")
            }

            fn visit_i64<E>(self, v: i64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                Ok(SafeId(v))
            }

            fn visit_u64<E>(self, v: u64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                Ok(SafeId(v as i64))
            }

            fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                v.trim()
                    .parse::<i64>()
                    .map(SafeId)
                    .map_err(|e| de::Error::custom(format!("invalid safe_id integer string: {e}")))
            }

            fn visit_string<E>(self, v: String) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                self.visit_str(&v)
            }
        }

        deserializer.deserialize_any(SafeIdVisitor)
    }
}
