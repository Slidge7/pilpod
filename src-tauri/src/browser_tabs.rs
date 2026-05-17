//! Per-browser tab slots and command queue shared by GSMTC and the localhost HTTP bridge.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use serde::Serialize;

use crate::gsmtc::dto::BrowserTabMediaDto;

/// Latest push from one browser profile (`browserId`).
#[derive(Debug, Clone)]
pub struct BrowserSlot {
    pub last_seen: Instant,
    pub connection_state: String,
    pub tabs: Vec<BrowserTabMediaDto>,
}

/// Key: browserId UUID sent by the extension.
pub type BrowserTabsMap = Arc<Mutex<HashMap<String, BrowserSlot>>>;

/// Commands the desktop app queues for a browser profile; the companion extension
/// receives them in the JSON body of its next POST to `/browser-media`.
pub type BrowserCommandsQueue = Arc<Mutex<HashMap<String, Vec<BrowserMediaCommand>>>>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserMediaCommand {
    pub tab_id: i32,
    /// `playPause`, `next`, `previous`, or `focusTab`
    pub action: String,
    /// Timestamp of when the command was enqueued; used to drop stale entries.
    /// Not sent to the extension.
    #[serde(skip)]
    pub enqueued_at: Instant,
}

pub fn enqueue_browser_command(
    queue: &BrowserCommandsQueue,
    browser_id: &str,
    tab_id: i32,
    action: &str,
) {
    if let Ok(mut q) = queue.lock() {
        q.entry(browser_id.to_string())
            .or_default()
            .push(BrowserMediaCommand {
                tab_id,
                action: action.to_string(),
                enqueued_at: Instant::now(),
            });
    }
}

/// Build the flat list for the UI. Omits a browser entirely when the last successful
/// POST reported `disconnected` and nothing newer arrived within 1s (extension health).
pub fn flatten_tabs(map: &HashMap<String, BrowserSlot>) -> Vec<BrowserTabMediaDto> {
    flatten_tabs_at(map, Instant::now())
}

pub(crate) fn flatten_tabs_at(
    map: &HashMap<String, BrowserSlot>,
    now: Instant,
) -> Vec<BrowserTabMediaDto> {
    let disconnect_grace = Duration::from_secs(1);
    map.values()
        .filter(|slot| {
            let elapsed = now.duration_since(slot.last_seen);
            if slot.connection_state.eq_ignore_ascii_case("disconnected")
                && elapsed > disconnect_grace
            {
                return false;
            }
            true
        })
        .flat_map(|slot| slot.tabs.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tab(tab_id: i32) -> BrowserTabMediaDto {
        BrowserTabMediaDto {
            tab_id,
            browser_id: String::new(),
            url: String::new(),
            title: format!("tab-{tab_id}"),
            artist: String::new(),
            album: String::new(),
            playback_state: String::new(),
            artwork_url: String::new(),
            duration: 0.0,
            current_time: 0.0,
            browser_name: String::new(),
            connection_state: String::new(),
        }
    }

    #[test]
    fn flatten_keeps_connected_and_stale_disconnected_drops() {
        let now = Instant::now();
        let mut map = HashMap::new();
        map.insert(
            "a".into(),
            BrowserSlot {
                last_seen: now - Duration::from_millis(500),
                connection_state: "connected".into(),
                tabs: vec![tab(1)],
            },
        );
        map.insert(
            "b".into(),
            BrowserSlot {
                last_seen: now - Duration::from_millis(2000),
                connection_state: "Disconnected".into(),
                tabs: vec![tab(2)],
            },
        );
        map.insert(
            "c".into(),
            BrowserSlot {
                last_seen: now - Duration::from_millis(500),
                connection_state: "disconnected".into(),
                tabs: vec![tab(3)],
            },
        );

        let out = flatten_tabs_at(&map, now);
        let mut ids: Vec<i32> = out.iter().map(|t| t.tab_id).collect();
        ids.sort_unstable();
        assert_eq!(ids, vec![1, 3]);
    }

    #[test]
    fn enqueue_orders_per_browser() {
        let q: BrowserCommandsQueue =
            Arc::new(Mutex::new(HashMap::new()));
        enqueue_browser_command(&q, "b1", 10, "next");
        enqueue_browser_command(&q, "b1", 11, "previous");
        enqueue_browser_command(&q, "b2", 20, "playPause");
        let g = q.lock().expect("lock");
        assert_eq!(g["b1"].len(), 2);
        assert_eq!(g["b1"][0].tab_id, 10);
        assert_eq!(g["b1"][1].action, "previous");
        assert_eq!(g["b2"][0].tab_id, 20);
    }
}
