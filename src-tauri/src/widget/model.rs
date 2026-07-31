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

/// User-selectable bounds for the collapsed triangle, in logical pixels.
///
/// The window is sized to the triangle exactly — there is no plate behind it —
/// so this is both the artwork size and the window size. Padding would put
/// transparent space between the triangle and the screen edge and break the
/// flush-corner look. Mirrored by `WIDGET_SIZE_*` in
/// `src/features/widget/types.ts`.
pub const CHIP_MIN_PX: f64 = 16.0;
pub const CHIP_MAX_PX: f64 = 96.0;
pub const CHIP_DEFAULT_PX: f64 = 40.0;

/// Logical size of the expanded panel.
///
/// Two heights, not two windows: the panel opens showing only what is playing,
/// and grows downward-into-the-screen when the user asks for the full browser
/// list. Anchoring both on the same corner means the growth reads as the panel
/// unfolding rather than a new surface appearing.
pub const PANEL_LOGICAL_W: f64 = 360.0;
pub const PANEL_LOGICAL_H: f64 = 400.0;
pub const PANEL_LOGICAL_H_WITH_BROWSERS: f64 = 600.0;

/// Accent for the glass chip.
///
/// A fixed palette rather than a free colour picker: each solid accent is
/// authored as a matched set of glass stops (fill, highlight, edge) in
/// `chip.css`, which is what keeps them looking like frosted glass instead of
/// flat translucent paint. An arbitrary hex value would have to derive those
/// stops at runtime and would land somewhere muddier.
///
/// [`Self::Hologram`] is not a colour at all — it selects an animated
/// multi-hue treatment whose implementation lives entirely in CSS. Rust only
/// needs to remember that the user picked it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WidgetAccent {
    Blue,
    Green,
    Yellow,
    Red,
    Hologram,
}

impl Default for WidgetAccent {
    fn default() -> Self {
        Self::Blue
    }
}

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
    #[serde(default)]
    pub accent: WidgetAccent,
    #[serde(default = "default_size")]
    pub size: f64,
}

const fn default_version() -> u32 {
    SETTINGS_VERSION
}

const fn default_size() -> f64 {
    CHIP_DEFAULT_PX
}

/// Bring a size into range.
///
/// Clamped in Rust rather than trusted from the slider: the value also arrives
/// from disk, where a hand-edited or truncated file could carry anything —
/// including `NaN`, which would propagate silently through the geometry and
/// leave the widget unpositionable.
pub fn clamp_size(size: f64) -> f64 {
    if !size.is_finite() {
        return CHIP_DEFAULT_PX;
    }
    size.clamp(CHIP_MIN_PX, CHIP_MAX_PX)
}

impl Default for WidgetSettings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            enabled: false,
            placement: WidgetPlacement::default(),
            accent: WidgetAccent::default(),
            size: CHIP_DEFAULT_PX,
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
    pub accent: WidgetAccent,
    pub size: f64,
    /// True while the widget window is showing the expanded media panel.
    pub expanded: bool,
    /// True while the expanded panel is also showing the full browser list.
    pub browsers_open: bool,
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
        assert_eq!(s.accent, WidgetAccent::Blue);
        assert_eq!(s.size, CHIP_DEFAULT_PX);
    }

    #[test]
    fn size_is_clamped_into_range() {
        assert_eq!(clamp_size(40.0), 40.0);
        assert_eq!(clamp_size(0.0), CHIP_MIN_PX);
        assert_eq!(clamp_size(1_000.0), CHIP_MAX_PX);
        assert_eq!(clamp_size(CHIP_MIN_PX), CHIP_MIN_PX);
        assert_eq!(clamp_size(CHIP_MAX_PX), CHIP_MAX_PX);
    }

    #[test]
    fn non_finite_sizes_fall_back_rather_than_poison_the_geometry() {
        assert_eq!(clamp_size(f64::NAN), CHIP_DEFAULT_PX);
        assert_eq!(clamp_size(f64::INFINITY), CHIP_DEFAULT_PX);
        assert_eq!(clamp_size(f64::NEG_INFINITY), CHIP_DEFAULT_PX);
    }

    #[test]
    fn accents_serialize_as_camel_case_names() {
        assert_eq!(
            serde_json::to_string(&WidgetAccent::Yellow).unwrap(),
            r#""yellow""#
        );
        assert_eq!(
            serde_json::from_str::<WidgetAccent>(r#""red""#).unwrap(),
            WidgetAccent::Red
        );
        assert_eq!(
            serde_json::to_string(&WidgetAccent::Hologram).unwrap(),
            r#""hologram""#
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
