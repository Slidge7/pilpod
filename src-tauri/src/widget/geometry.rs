//! Pure placement math for the floating widget.
//!
//! Every function here is a total function over plain integers — no Tauri
//! types, no monitor handles, no I/O. The window layer resolves the monitor
//! work area and window size, hands them in, and applies whatever comes back.
//! That separation is what makes the tricky parts (flush corners, expanding
//! the panel *inward*, clamping a dragged widget back on-screen after a
//! monitor is unplugged) testable without a display attached.
//!
//! All coordinates are **physical** pixels, matching what Tauri's
//! `work_area()` / `outer_size()` report. Logical sizes are scaled by the
//! caller so DPI never leaks into the math.

use super::model::WidgetCorner;

/// An axis-aligned rectangle in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Rect {
    pub const fn right(self) -> i32 {
        self.x + self.w
    }
    pub const fn bottom(self) -> i32 {
        self.y + self.h
    }
    pub const fn center_x(self) -> i32 {
        self.x + self.w / 2
    }
    pub const fn center_y(self) -> i32 {
        self.y + self.h / 2
    }
    pub const fn contains_point(self, px: i32, py: i32) -> bool {
        px >= self.x && px < self.right() && py >= self.y && py < self.bottom()
    }
}

/// Top-left position that puts a `win_w × win_h` window flush into `corner`
/// of `area`.
///
/// "Flush" is literal: zero margin. The widget's own rounded geometry supplies
/// the visual inset, so the window rectangle can sit exactly on the work-area
/// boundary and the chip reads as growing out of the screen edge.
pub fn corner_position(area: Rect, win_w: i32, win_h: i32, corner: WidgetCorner) -> (i32, i32) {
    let (ax, ay) = corner.anchor();
    let x = if ax == 0.0 { area.x } else { area.right() - win_w };
    let y = if ay == 0.0 { area.y } else { area.bottom() - win_h };
    (x, y)
}

/// Which corner of `area` a window at (`win_x`, `win_y`) sits nearest to.
///
/// Used for free placement: the expanded panel must grow *into* the screen,
/// so a chip parked bottom-right expands up-and-left, not down-and-right off
/// the edge. Ties (a perfectly centred widget) resolve toward top-left, which
/// is the direction with the most room on a standard work area.
pub fn nearest_corner(area: Rect, win_x: i32, win_y: i32, win_w: i32, win_h: i32) -> WidgetCorner {
    let cx = win_x + win_w / 2;
    let cy = win_y + win_h / 2;
    match (cx > area.center_x(), cy > area.center_y()) {
        (false, false) => WidgetCorner::TopLeft,
        (true, false) => WidgetCorner::TopRight,
        (false, true) => WidgetCorner::BottomLeft,
        (true, true) => WidgetCorner::BottomRight,
    }
}

/// Keep a resize anchored to `corner` — the edges meeting at that corner stay
/// put while the window changes size.
///
/// This is what makes expand/collapse feel like the panel unfolds *from* the
/// chip instead of the chip teleporting: the shared corner is the fixed point
/// of the transform.
pub fn anchored_resize(
    old_x: i32,
    old_y: i32,
    old_w: i32,
    old_h: i32,
    new_w: i32,
    new_h: i32,
    corner: WidgetCorner,
) -> (i32, i32) {
    let (ax, ay) = corner.anchor();
    let x = if ax == 0.0 {
        old_x
    } else {
        old_x + old_w - new_w
    };
    let y = if ay == 0.0 {
        old_y
    } else {
        old_y + old_h - new_h
    };
    (x, y)
}

/// Pull a window fully back inside `area`.
///
/// Two situations need this and they want opposite biases, so the order
/// matters: clamp the far edge first, then the near edge. A window *larger*
/// than the work area therefore ends up aligned to the top-left rather than
/// pushed off it — degraded, but still grabbable.
pub fn clamp_into(area: Rect, win_x: i32, win_y: i32, win_w: i32, win_h: i32) -> (i32, i32) {
    let mut x = win_x;
    let mut y = win_y;
    if x + win_w > area.right() {
        x = area.right() - win_w;
    }
    if y + win_h > area.bottom() {
        y = area.bottom() - win_h;
    }
    if x < area.x {
        x = area.x;
    }
    if y < area.y {
        y = area.y;
    }
    (x, y)
}

/// Pick the work area a window belongs to.
///
/// Preference order: the area whose rectangle contains the window's centre,
/// then whichever area's centre is closest. The fallback matters when a
/// monitor is unplugged — the stored free position can land in dead space, and
/// "nearest monitor" moves the widget somewhere the user will actually find it
/// instead of leaving it off-screen.
pub fn work_area_for<'a>(areas: &'a [Rect], win_x: i32, win_y: i32, win_w: i32, win_h: i32) -> Option<&'a Rect> {
    if areas.is_empty() {
        return None;
    }
    let cx = win_x + win_w / 2;
    let cy = win_y + win_h / 2;
    if let Some(hit) = areas.iter().find(|a| a.contains_point(cx, cy)) {
        return Some(hit);
    }
    areas.iter().min_by_key(|a| {
        let dx = i64::from(a.center_x() - cx);
        let dy = i64::from(a.center_y() - cy);
        dx * dx + dy * dy
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 1920×1080 with a 40px taskbar at the bottom.
    const AREA: Rect = Rect {
        x: 0,
        y: 0,
        w: 1920,
        h: 1040,
    };

    #[test]
    fn corners_are_flush_with_the_work_area() {
        assert_eq!(corner_position(AREA, 50, 50, WidgetCorner::TopLeft), (0, 0));
        assert_eq!(
            corner_position(AREA, 50, 50, WidgetCorner::TopRight),
            (1870, 0)
        );
        assert_eq!(
            corner_position(AREA, 50, 50, WidgetCorner::BottomLeft),
            (0, 990)
        );
        assert_eq!(
            corner_position(AREA, 50, 50, WidgetCorner::BottomRight),
            (1870, 990)
        );
    }

    #[test]
    fn corners_respect_a_shifted_secondary_monitor() {
        let area = Rect {
            x: -1920,
            y: 200,
            w: 1920,
            h: 1080,
        };
        assert_eq!(
            corner_position(area, 50, 50, WidgetCorner::TopLeft),
            (-1920, 200)
        );
        assert_eq!(
            corner_position(area, 50, 50, WidgetCorner::BottomRight),
            (-50, 1230)
        );
    }

    #[test]
    fn nearest_corner_uses_the_widget_centre() {
        assert_eq!(nearest_corner(AREA, 0, 0, 50, 50), WidgetCorner::TopLeft);
        assert_eq!(
            nearest_corner(AREA, 1870, 990, 50, 50),
            WidgetCorner::BottomRight
        );
        assert_eq!(
            nearest_corner(AREA, 1870, 0, 50, 50),
            WidgetCorner::TopRight
        );
        // Dead centre resolves to top-left rather than oscillating.
        assert_eq!(
            nearest_corner(AREA, AREA.center_x() - 25, AREA.center_y() - 25, 50, 50),
            WidgetCorner::TopLeft
        );
    }

    #[test]
    fn expanding_keeps_the_anchor_corner_pinned() {
        // Bottom-right chip at (1870, 990) grows up-and-left into a panel.
        let (x, y) = anchored_resize(1870, 990, 50, 50, 360, 450, WidgetCorner::BottomRight);
        assert_eq!((x + 360, y + 450), (1920, 1040));

        // Top-left chip keeps its origin.
        assert_eq!(
            anchored_resize(0, 0, 50, 50, 360, 450, WidgetCorner::TopLeft),
            (0, 0)
        );
    }

    #[test]
    fn collapsing_is_the_inverse_of_expanding() {
        let grown = anchored_resize(1870, 990, 50, 50, 360, 450, WidgetCorner::BottomRight);
        let shrunk = anchored_resize(
            grown.0,
            grown.1,
            360,
            450,
            50,
            50,
            WidgetCorner::BottomRight,
        );
        assert_eq!(shrunk, (1870, 990));
    }

    #[test]
    fn clamp_pulls_an_offscreen_widget_back() {
        assert_eq!(clamp_into(AREA, 5000, 5000, 50, 50), (1870, 990));
        assert_eq!(clamp_into(AREA, -300, -300, 50, 50), (0, 0));
        assert_eq!(clamp_into(AREA, 100, 100, 50, 50), (100, 100));
    }

    #[test]
    fn clamp_of_an_oversized_window_favours_the_near_edge() {
        assert_eq!(clamp_into(AREA, 40, 40, 3000, 3000), (0, 0));
    }

    #[test]
    fn work_area_lookup_prefers_containment_then_distance() {
        let primary = AREA;
        let secondary = Rect {
            x: 1920,
            y: 0,
            w: 1920,
            h: 1080,
        };
        let areas = [primary, secondary];

        assert_eq!(
            work_area_for(&areas, 2000, 100, 50, 50),
            Some(&secondary)
        );
        assert_eq!(work_area_for(&areas, 100, 100, 50, 50), Some(&primary));
        // Far off to the right of everything → nearest is the secondary.
        assert_eq!(
            work_area_for(&areas, 9000, 500, 50, 50),
            Some(&secondary)
        );
        assert_eq!(work_area_for(&[], 0, 0, 50, 50), None);
    }
}
