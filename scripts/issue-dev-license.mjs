#!/usr/bin/env node
// Dev helper: issue a PP1 license token signed with the DEV keypair.
// Equivalent to `cargo run --bin license_tool -- issue ...` but needs only Node.
//
// Usage:
//   node scripts/issue-dev-license.mjs --email you@example.com [--plan premium] [--features downloader] [--days 365]
//
// Reads the private key from scripts/dev-license-key.json (gitignored):
//   { "privateSeedB64url": "...", "publicKeyB64url": "..." }

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const keyPath = path.join(dir, "dev-license-key.json");
if (!fs.existsSync(keyPath)) {
  console.error(`Missing ${keyPath}. Create it with privateSeedB64url/publicKeyB64url.`);
  process.exit(1);
}
const { privateSeedB64url } = JSON.parse(fs.readFileSync(keyPath, "utf8"));

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const email = arg("--email");
if (!email) {
  console.error("--email is required");
  process.exit(1);
}
const plan = arg("--plan", "premium");
const features = arg("--features", "downloader").split(",").map((s) => s.trim()).filter(Boolean);
const days = arg("--days", null);
const now = Math.floor(Date.now() / 1000);

const payload = JSON.stringify({
  email,
  plan,
  features,
  issued_at: now,
  expires_at: days ? now + Number(days) * 86400 : null,
});

// Rebuild an Ed25519 private key from the 32-byte seed (PKCS8 wrapper).
const seed = Buffer.from(privateSeedB64url, "base64url");
const pkcs8 = Buffer.concat([
  Buffer.from("302e020100300506032b657004220420", "hex"),
  seed,
]);
const key = crypto.createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
const sig = crypto.sign(null, Buffer.from(payload), key);

console.log(`PP1.${Buffer.from(payload).toString("base64url")}.${sig.toString("base64url")}`);
