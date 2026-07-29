//! Widget settings value types — the vocabulary shared by Rust, the dashboard
//! menu and the widget window itself.
//!
//! Everything here is plain data: no `AppHandle`, no I/O, no Windows APIs. That
//! keeps the placement rules unit-testable on any platform and makes the
//! serialized shape the single contract the frontend codes against
//! (`src/features/widget/types.ts` mirrors it 1:1).

use serde::{Deserialize, Serialize};

/// Current on-disk schema version. Bump when a field changes meaning; the
/// loader treats anything newer as "written by a future build" and starts from
/// defaults rather than mangling the user's settings.
pub const SETTINGS_VERSION: u32 = 1;

/// Logical (DPI-independent) size of the collapsed chip.
///
/// The chip is the PilPod logo and nothing else — no plate, no background — so
/// the window is sized to the artwork. Anything larger would put transparent
/// padding between the logo and the screen edge and break the "absolute
/// corner" look. Mirrored by `WIDGET_CHIP_PX` in `src/features/widget/types.ts`.
pub const CHIP_LOGICAL_PX: f64 = 34.0;
/// Logical size of the expanded "media list" panel.
pub const PANEL_LOGICAL_W: f64 = 360.0;
pub const PANEL_LOGICAL_H: f64 = 450.0;

/// Which screen corner the widget is pinned to.
///
/// Corner placement is *flush*: the widget sits exactly in the work-area
/// corner with no margin, so the rounded side always faces inward and the
/// chip reads as part of the screen edge rather than as a floating dot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WidgetCorner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

impl WidgetCorner {
    /// Unit anchor of the corner inside a rect: `(0,0)` = top-left,
    /// `(1,1)` = bottom-right. Used by the geometry math and mirrored by the
    /// CSS rotation classes in the widget window.
    pub const fn anchor(self) -> (f64, f64) {
        match self {
            Self::TopLeft => (0.0, 0.0),
            Self::TopRight => (1.0, 0.0),
            Self::BottomLeft => (0.0, 1.0),
            Self::BottomRight => (1.0, 1.0),
        }
    }
}

/// Where the widget lives.
///
/// Serialized as an internally tagged union so the TypeScript side gets a
/// discriminated union it can `switch` on exhaustively:
/// `{ mode: "free", x, y } | { mode: "corner", corner: "bottomRight" }`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum WidgetPlacement {
    /// User-positioned. `x`/`y` are the *logical* top-left of the window.
    Free { x: f64, y: f64 },
    /// Pinned flush to a work-area corner; re-applied on monitor/DPI changes.
    Corner { corner: WidgetCorner },
}

impl WidgetPlacement {
    pub const fn is_free(self) -> bool {
        matches!(self, Self::Free { .. })
    }
}

impl Default for WidgetPlacement {
    fn default() -> Self {
        Self::Corner {
            corner: WidgetCorner::BottomRight,
        }
    }
}

/// The persisted widget configuration.
///
/// `expanded` deliberately is **not** stored: the panel is a transient
/// interaction, and restoring a 360×450 panel on launch would be surprising.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetSettings {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub placement: WidgetPlacement,
}

const fn default_version() -> u32 {
    SETTINGS_VERSION
}

impl Default for WidgetSettings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            enabled: false,
            placement: WidgetPlacement::default(),
        }
    }
}

/// What the frontend receives from `widget_get_state` and the `widget://state`
/// event. Adds the live, non-persisted bits to the stored settings.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetState {
    pub enabled: bool,
    pub placement: WidgetPlacement,
    /// True while the widget window is showing the expanded media panel.
    pub expanded: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placement_round_trips_as_a_tagged_union() {
        let corner = WidgetPlacement::Corner {
            corner: WidgetCorner::TopLeft,
        };
        let json = serde_json::to_string(&corner).unwrap();
        assert_eq!(json, r#"{"mode":"corner","corner":"topLeft"}"#);
        assert_eq!(
            serde_json::from_str::<WidgetPlacement>(&json).unwrap(),
            corner
        );

        let free = WidgetPlacement::Free { x: 12.5, y: -3.0 };
        let json = serde_json::to_string(&free).unwrap();
        assert_eq!(json, r#"{"mode":"free","x":12.5,"y":-3.0}"#);
        assert_eq!(serde_json::from_str::<WidgetPlacement>(&json).unwrap(), free);
    }

    #[test]
    fn settings_default_to_disabled_bottom_right() {
        let s = WidgetSettings::default();
        assert!(!s.enabled);
        assert_eq!(
            s.placement,
            WidgetPlacement::Corner {
                corner: WidgetCorner::BottomRight
            }
        );
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let s: WidgetSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(s, WidgetSettings::default());
    }

    #[test]
    fn corner_anchors_are_the_unit_square() {
        assert_eq!(WidgetCorner::TopLeft.anchor(), (0.0, 0.0));
        assert_eq!(WidgetCorner::TopRight.anchor(), (1.0, 0.0));
        assert_eq!(WidgetCorner::BottomLeft.anchor(), (0.0, 1.0));
        assert_eq!(WidgetCorner::BottomRight.anchor(), (1.0, 1.0));
    }
}
