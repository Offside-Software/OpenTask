use argon2:: {
    password_hash::{PasswordHasher, PasswordVerifier, phc::PasswordHash},
    Argon2
};

pub fn hash_string(input: &str) -> Result<String, argon2::password_hash::Error> {
    let argon2 = Argon2::default();
    let hash = argon2.hash_password(input.as_bytes())?;
    Ok(hash.to_string())
}

pub fn verify_hash(input: &str, hash: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(parsed) => Argon2::default().verify_password(input.as_bytes(), &parsed).is_ok(),
        Err(_) => false,
    }
}
