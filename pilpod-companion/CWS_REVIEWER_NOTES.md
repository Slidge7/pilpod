# Chrome Web Store — Reviewer Notes

Copy and paste the following into the CWS submission form:

> PilPod Companion is a local bridge for the PilPod desktop application. It uses a hybrid injection model. The manifest statically injects into known media platforms (YouTube, Netflix, etc.) to sync media state (play/pause/title) to the user's local desktop via WebSocket (ws://127.0.0.1). It does not use `<all_urls>`. For custom media sites, the extension uses the `scripting` and `activeTab` permissions to allow users to manually grant host access to specific domains via the popup UI. No data is sent to external cloud servers; all telemetry is strictly local.
