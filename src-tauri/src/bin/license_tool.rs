//! Dev tool: generate license signing keypairs and issue PP1 license tokens.
//!
//! Usage (from src-tauri/):
//!   cargo run --bin license_tool -- keygen
//!   cargo run --bin license_tool -- issue --priv <b64url_seed> --email a@b.c [--plan premium] [--features downloader] [--days 365]
//!
//! `keygen` prints the Rust array to paste into premium/license.rs
//! (LICENSE_PUBKEY). Keep the private seed OUT of git.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};

fn arg_value(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("keygen") => keygen(),
        Some("issue") => issue(&args),
        _ => {
            eprintln!("usage: license_tool keygen | issue --priv <seed> --email <email> [--plan premium] [--features downloader[,x]] [--days N]");
            std::process::exit(2);
        }
    }
}

fn keygen() {
    let mut seed = [0u8; 32];
    getrandom::getrandom(&mut seed).expect("os rng");
    let signing = SigningKey::from_bytes(&seed);
    let pubkey = signing.verifying_key().to_bytes();
    println!("PRIVATE_SEED_B64URL={}", URL_SAFE_NO_PAD.encode(seed));
    println!("PUBLIC_KEY_B64URL={}", URL_SAFE_NO_PAD.encode(pubkey));
    println!(
        "LICENSE_PUBKEY: [u8; 32] = [{}];",
        pubkey
            .iter()
            .map(|b| b.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    );
    println!("\n⚠ Store the private seed securely. Never commit it.");
}

fn issue(args: &[String]) {
    let seed_b64 = arg_value(args, "--priv").unwrap_or_else(|| {
        eprintln!("--priv <b64url_seed> is required");
        std::process::exit(2);
    });
    let email = arg_value(args, "--email").unwrap_or_else(|| {
        eprintln!("--email is required");
        std::process::exit(2);
    });
    let plan = arg_value(args, "--plan").unwrap_or_else(|| "premium".into());
    let features: Vec<String> = arg_value(args, "--features")
        .unwrap_or_else(|| "downloader".into())
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let expires_at: Option<u64> = arg_value(args, "--days")
        .map(|d| d.parse::<u64>().expect("--days must be a number"))
        .map(|days| now_unix() + days * 86_400);

    let seed_bytes = URL_SAFE_NO_PAD
        .decode(seed_b64.trim())
        .expect("--priv must be base64url");
    let seed: [u8; 32] = seed_bytes.as_slice().try_into().expect("seed must be 32 bytes");
    let signing = SigningKey::from_bytes(&seed);

    let payload = serde_json::json!({
        "email": email,
        "plan": plan,
        "features": features,
        "issued_at": now_unix(),
        "expires_at": expires_at,
    });
    let payload_str = serde_json::to_string(&payload).unwrap();
    let sig = signing.sign(payload_str.as_bytes());

    println!(
        "PP1.{}.{}",
        URL_SAFE_NO_PAD.encode(&payload_str),
        URL_SAFE_NO_PAD.encode(sig.to_bytes())
    );
}
