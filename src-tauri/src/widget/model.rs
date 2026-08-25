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

/// Default edge length for the *free* chip.
///
/// Larger than the corner default because the two shapes are not the same
/// object at the same size. The corner form is a triangle wedged into a screen
/// corner, where half its bounding box is empty and the screen edges frame it;
/// the free form is a sphere floating in the middle of a desktop with nothing
/// around it, carrying the PilPod mark. At 40 it reads as a stray dot. 47 is
/// where it becomes a deliberate object again — and it is a starting point, not
/// a lock: the slider still spans the full range.
pub const CHIP_FREE_DEFAULT_PX: f64 = 47.0;

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
/// All four fields are settings the user chose, so all four are stored. There
/// is no transient runtime state to keep out of the file: whether the chip is
/// on screen at a given moment is not remembered, it is derived from `enabled`
/// and where the app currently is (see `window::sync`).
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
    /// Edge length of the corner triangle.
    #[serde(default = "default_size")]
    pub size: f64,
    /// Diameter of the free-floating sphere.
    ///
    /// A second size rather than one shared value, because the two forms want
    /// different ones (see [`CHIP_FREE_DEFAULT_PX`]) and because a user who
    /// tunes the bubble to 60 and then pins it to a corner should find their
    /// triangle exactly as they left it. Switching modes recalls a size; it
    /// never overwrites one.
    #[serde(default = "default_free_size")]
    pub free_size: f64,
}

const fn default_version() -> u32 {
    SETTINGS_VERSION
}

const fn default_size() -> f64 {
    CHIP_DEFAULT_PX
}

const fn default_free_size() -> f64 {
    CHIP_FREE_DEFAULT_PX
}

impl WidgetSettings {
    /// The size that applies to the shape currently on screen.
    ///
    /// Everything outside this file — the geometry, the slider, the window —
    /// deals in "the chip's size" and never has to know there are two.
    pub fn active_size(&self) -> f64 {
        clamp_size(if self.placement.is_free() {
            self.free_size
        } else {
            self.size
        })
    }

    /// Write the size of the shape currently on screen.
    pub fn set_active_size(&mut self, size: f64) {
        let clamped = clamp_size(size);
        if self.placement.is_free() {
            self.free_size = clamped;
        } else {
            self.size = clamped;
        }
    }
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
            free_size: CHIP_FREE_DEFAULT_PX,
        }
    }
}

/// What the frontend receives from `widget_get_state` and the `widget://state`
/// event.
///
/// Currently identical in content to [`WidgetSettings`] minus the schema
/// version — kept as its own type because the two answer different questions
/// ("what is on disk" vs "what should the UI draw") and the on-disk shape must
/// be free to gain a field without that field becoming part of the IPC
/// contract.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetState {
    pub enabled: bool,
    pub placement: WidgetPlacement,
    pub accent: WidgetAccent,
    /// The size of the shape currently on screen — the corner triangle's edge
    /// or the free sphere's diameter, whichever the placement implies. The
    /// frontend has one slider and this is what it binds to; switching
    /// placement swaps the value under it.
    pub size: f64,
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
        assert_eq!(s.free_size, CHIP_FREE_DEFAULT_PX);
    }

    #[test]
    fn each_shape_keeps_its_own_size() {
        let mut s = WidgetSettings::default();
        // Pinned: the slider drives the triangle.
        assert_eq!(s.active_size(), CHIP_DEFAULT_PX);
        s.set_active_size(72.0);
        assert_eq!(s.size, 72.0);
        assert_eq!(s.free_size, CHIP_FREE_DEFAULT_PX);

        // Unpinned: the bubble starts at its own default, untouched by the
        // triangle's 72.
        s.placement = WidgetPlacement::Free { x: 10.0, y: 10.0 };
        assert_eq!(s.active_size(), CHIP_FREE_DEFAULT_PX);
        s.set_active_size(30.0);
        assert_eq!(s.free_size, 30.0);

        // Pinning again recalls the triangle exactly as it was left.
        s.placement = WidgetPlacement::default();
        assert_eq!(s.active_size(), 72.0);
    }

    #[test]
    fn active_size_is_clamped_on_the_way_in_and_out() {
        let mut s = WidgetSettings::default();
        s.set_active_size(5_000.0);
        assert_eq!(s.active_size(), CHIP_MAX_PX);

        // A hand-edited file can carry anything; reading is clamped too.
        s.size = f64::NAN;
        assert_eq!(s.active_size(), CHIP_DEFAULT_PX);
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
