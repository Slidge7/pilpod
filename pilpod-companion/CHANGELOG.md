# Changelog — PilPod Companion

All notable protocol and extension changes are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.3.0] — 2026-05-23

### Added

- `GET /capabilities` — extension reads server-owned timing constants at startup.
- `protocolVersion` field on every HTTP POST and WebSocket frame.
- `bridgeConfig.js` runtime config module (defaults from `constants.js`, overridden by capabilities).

### Changed

- HTTP and WS transports read timing from `bridgeConfig` instead of hardcoded imports.
- Integration doc rewritten to match current ping/sync protocol.

## [1.2.0] — 2026-05

### Added

- WebSocket transport (`ws://127.0.0.1:17400/ws`) as primary path; HTTP polling as fallback.
- Ping vs sync split — lightweight heartbeats when tab state is unchanged.
- Backoff when desktop unreachable (`failThreshold = 4`, `sleepIntervalMs = 5000`).
- Stable profile UUID per browser profile (`browserId` in `chrome.storage.local`).
- Event-driven content script media detection (MutationObserver + media events).

### Changed

- Rust emits one UI row per extension profile UUID, not per OS browser executable.

## [1.1.0] — 2026-04

### Added

- Tab lifecycle states (`active`, `inactive`, `loading`, `sleeping`, `crashed`, `unknown`).
- Content-script page activity signals (`pageVisible`, `userIdleMs`, `documentState`).
- Tab commands: `reactivateTab`, `reloadTab`, `closeTab`.

[1.3.0]: https://github.com/pilpod/pilpod/compare/companion-v1.2.0...companion-v1.3.0
[1.2.0]: https://github.com/pilpod/pilpod/compare/companion-v1.1.0...companion-v1.2.0
[1.1.0]: https://github.com/pilpod/pilpod/releases/tag/companion-v1.1.0
