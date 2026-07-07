//! Protocol v2 typed frames — serde mirror of `/PROTOCOL.md` and the companion's
//! `src/bridge/protocol/messages.js`. Change all three together; the round-trip
//! tests below guard against drift.
//!
//! Every frame is an internally-tagged enum on field `t`. Hot-path frames
//! (`prog`) use short keys to stay under the 64-byte budget.

use serde::{Deserialize, Serialize};

// ── TabState ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TabState {
    pub tab_id: i64,
    #[serde(default)]
    pub window_id: i64,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default, alias = "favIconUrl")]
    pub fav_icon_url: String,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub window_focused: bool,
    #[serde(default)]
    pub audible: bool,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub index: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media: Option<TabMediaState>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TabMediaState {
    #[serde(default)]
    pub playback_state: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub artist: String,
    #[serde(default)]
    pub album: String,
    #[serde(default)]
    pub artwork_url: String,
    #[serde(default)]
    pub duration: f64,
    #[serde(default)]
    pub current_time: f64,
    #[serde(default = "default_tab_volume")]
    pub tab_volume: f64,
    #[serde(default)]
    pub tab_muted: bool,
    #[serde(default)]
    pub can_seek: bool,
    #[serde(default)]
    pub can_pip: bool,
    #[serde(default)]
    pub can_next: bool,
    #[serde(default)]
    pub can_prev: bool,
    /// True when this tab's video is currently in a Picture-in-Picture window.
    #[serde(default)]
    pub in_pip: bool,
}

fn default_tab_volume() -> f64 {
    100.0
}

// ── Shared command action enum ──────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaAction {
    PlayPause,
    Next,
    Previous,
    Seek,
    SetTabVolume,
    MuteTab,
    Pip,
    FocusTab,
    /// Focus a whole browser window; `value` carries the `windowId` (Phase 4).
    FocusWindow,
    ReactivateTab,
    ReloadTab,
    CloseTab,
}

// ── Client → App ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelloBrowser {
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub version: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelloCaps {
    #[serde(default)]
    pub delta: bool,
    #[serde(default)]
    pub progress: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "t")]
pub enum ClientMsg {
    #[serde(rename = "hello", rename_all = "camelCase")]
    Hello {
        v: u8,
        browser_id: String,
        #[serde(default)]
        browser: Option<HelloBrowser>,
        #[serde(default)]
        ext_version: String,
        #[serde(default)]
        token: Option<String>,
        #[serde(default)]
        caps: HelloCaps,
    },

    #[serde(rename = "full", rename_all = "camelCase")]
    Full { rev: u64, tabs: Vec<TabState> },

    #[serde(rename = "delta", rename_all = "camelCase")]
    Delta {
        rev: u64,
        #[serde(default)]
        upsert: Vec<TabState>,
        #[serde(default)]
        remove: Vec<i64>,
    },

    #[serde(rename = "prog", rename_all = "camelCase")]
    Prog {
        id: i64,
        ct: f64,
        st: u8,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        d: Option<f64>,
    },

    #[serde(rename = "ack", rename_all = "camelCase")]
    Ack {
        id: String,
        ok: bool,
        #[serde(default)]
        error: Option<String>,
    },

    #[serde(rename = "pong")]
    Pong { seq: u64 },

    #[serde(rename = "bye")]
    Bye,
}

// ── App → Client ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WelcomeCaps {
    pub progress_hz: u32,
    pub idle_ping_ms: u64,
    pub delta_debounce_ms: u64,
    pub max_tabs: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdItem {
    pub id: String,
    pub tab_id: i64,
    pub action: MediaAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "t")]
pub enum ServerMsg {
    #[serde(rename = "welcome", rename_all = "camelCase")]
    Welcome {
        v: u8,
        bridge: String,
        session_id: String,
        caps: WelcomeCaps,
    },

    #[serde(rename = "cmd", rename_all = "camelCase")]
    Cmd {
        id: String,
        tab_id: i64,
        action: MediaAction,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value: Option<f64>,
    },

    #[serde(rename = "cmds")]
    Cmds { items: Vec<CmdItem> },

    #[serde(rename = "resync")]
    Resync,

    #[serde(rename = "sub", rename_all = "camelCase")]
    Sub { tab_id: i64 },

    #[serde(rename = "unsub", rename_all = "camelCase")]
    Unsub { tab_id: i64 },

    #[serde(rename = "ping")]
    Ping { seq: u64 },
}

impl ServerMsg {
    /// Convenience: serialize to a JSON text frame.
    pub fn to_frame(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| String::from("{\"t\":\"resync\"}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hello_round_trips_with_tag() {
        let raw = r#"{"t":"hello","v":2,"browserId":"abc","browser":{"name":"Chrome","type":"chrome","version":"126"},"extVersion":"3.0.0","token":null,"caps":{"delta":true,"progress":true}}"#;
        let msg: ClientMsg = serde_json::from_str(raw).expect("decode hello");
        match &msg {
            ClientMsg::Hello { v, browser_id, caps, .. } => {
                assert_eq!(*v, 2);
                assert_eq!(browser_id, "abc");
                assert!(caps.delta && caps.progress);
            }
            _ => panic!("wrong variant"),
        }
        let re = serde_json::to_string(&msg).expect("encode hello");
        assert!(re.contains("\"t\":\"hello\""));
    }

    #[test]
    fn delta_decodes_upsert_and_remove() {
        let raw = r#"{"t":"delta","rev":2,"upsert":[{"tabId":1,"url":"x","media":null}],"remove":[9]}"#;
        let msg: ClientMsg = serde_json::from_str(raw).expect("decode delta");
        match msg {
            ClientMsg::Delta { rev, upsert, remove } => {
                assert_eq!(rev, 2);
                assert_eq!(upsert.len(), 1);
                assert_eq!(remove, vec![9]);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn prog_is_compact() {
        let raw = r#"{"t":"prog","id":7,"ct":12.3,"st":1}"#;
        let msg: ClientMsg = serde_json::from_str(raw).expect("decode prog");
        match msg {
            ClientMsg::Prog { id, st, d, .. } => {
                assert_eq!(id, 7);
                assert_eq!(st, 1);
                assert!(d.is_none());
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn cmd_serializes_camel_case_action() {
        let cmd = ServerMsg::Cmd {
            id: "c-1".into(),
            tab_id: 5,
            action: MediaAction::PlayPause,
            value: None,
        };
        let json = cmd.to_frame();
        assert!(json.contains("\"t\":\"cmd\""));
        assert!(json.contains("\"action\":\"playPause\""));
        assert!(json.contains("\"tabId\":5"));
    }

    #[test]
    fn welcome_round_trips() {
        let w = ServerMsg::Welcome {
            v: 2,
            bridge: "2.0".into(),
            session_id: "s1".into(),
            caps: WelcomeCaps { progress_hz: 5, idle_ping_ms: 15000, delta_debounce_ms: 40, max_tabs: 500 },
        };
        let json = w.to_frame();
        let back: ServerMsg = serde_json::from_str(&json).expect("decode welcome");
        match back {
            ServerMsg::Welcome { caps, .. } => assert_eq!(caps.progress_hz, 5),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn all_actions_map_to_camel_case() {
        let pairs = [
            (MediaAction::PlayPause, "playPause"),
            (MediaAction::Next, "next"),
            (MediaAction::Previous, "previous"),
            (MediaAction::Seek, "seek"),
            (MediaAction::SetTabVolume, "setTabVolume"),
            (MediaAction::MuteTab, "muteTab"),
            (MediaAction::Pip, "pip"),
            (MediaAction::FocusTab, "focusTab"),
            (MediaAction::ReactivateTab, "reactivateTab"),
            (MediaAction::ReloadTab, "reloadTab"),
            (MediaAction::CloseTab, "closeTab"),
        ];
        for (action, expected) in pairs {
            let json = serde_json::to_string(&action).unwrap();
            assert_eq!(json, format!("\"{expected}\""));
        }
    }
}
