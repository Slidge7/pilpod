//! Translation between browser extension volume scale (0–600%) and
//! internal desktop app / UI scale (0–150%).
//!
//! The browser extension expects media volume up to 600% (using Web Audio gain).
//! The desktop app and UI operate on a 0–150% scale, where:
//! - 0%–100% is identical (1:1).
//! - 100%–150% maps linearly to the extension's 100%–600% boost headroom (factor of 10).

pub const APP_VOL_MAX: f64 = 150.0;
pub const EXT_VOL_MAX: f64 = 600.0;
pub const NORMAL_VOL_MAX: f64 = 100.0;

/// Map extension volume (0–600%) to internal app volume (0–150%).
pub fn ext_to_app_volume(ext_vol: f64) -> f64 {
    let v = ext_vol.clamp(0.0, EXT_VOL_MAX);
    if v <= NORMAL_VOL_MAX {
        v
    } else {
        (NORMAL_VOL_MAX + (v - NORMAL_VOL_MAX) / 10.0).clamp(0.0, APP_VOL_MAX)
    }
}

/// Map internal app volume (0–150%) to extension volume (0–600%).
pub fn app_to_ext_volume(app_vol: f64) -> f64 {
    let v = app_vol.clamp(0.0, APP_VOL_MAX);
    if v <= NORMAL_VOL_MAX {
        v
    } else {
        (NORMAL_VOL_MAX + (v - NORMAL_VOL_MAX) * 10.0).clamp(0.0, EXT_VOL_MAX)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normal_range_identity() {
        assert_eq!(ext_to_app_volume(0.0), 0.0);
        assert_eq!(ext_to_app_volume(25.0), 25.0);
        assert_eq!(ext_to_app_volume(50.0), 50.0);
        assert_eq!(ext_to_app_volume(100.0), 100.0);

        assert_eq!(app_to_ext_volume(0.0), 0.0);
        assert_eq!(app_to_ext_volume(25.0), 25.0);
        assert_eq!(app_to_ext_volume(50.0), 50.0);
        assert_eq!(app_to_ext_volume(100.0), 100.0);
    }

    #[test]
    fn boost_range_scaling() {
        // UI 110% -> Ext 200%
        assert_eq!(app_to_ext_volume(110.0), 200.0);
        assert_eq!(ext_to_app_volume(200.0), 110.0);

        // UI 125% -> Ext 350%
        assert_eq!(app_to_ext_volume(125.0), 350.0);
        assert_eq!(ext_to_app_volume(350.0), 125.0);

        // UI 150% -> Ext 600%
        assert_eq!(app_to_ext_volume(150.0), 600.0);
        assert_eq!(ext_to_app_volume(600.0), 150.0);
    }

    #[test]
    fn roundtrip_consistency() {
        for pct in 0..=150 {
            let app = pct as f64;
            let ext = app_to_ext_volume(app);
            let back = ext_to_app_volume(ext);
            assert!((back - app).abs() < 1e-6, "mismatch at {app}: back={back}");
        }
    }

    #[test]
    fn out_of_bounds_clamping() {
        assert_eq!(ext_to_app_volume(-10.0), 0.0);
        assert_eq!(ext_to_app_volume(1000.0), 150.0);

        assert_eq!(app_to_ext_volume(-10.0), 0.0);
        assert_eq!(app_to_ext_volume(300.0), 600.0);
    }
}
