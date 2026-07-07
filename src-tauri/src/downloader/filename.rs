//! Custom-filename sanitization for Windows.
//!
//! The output directory comes exclusively from the validated settings/dialog
//! path; the filename must therefore never be able to escape it or produce an
//! invalid/reserved Windows name.

const MAX_LEN_CHARS: usize = 200;

/// Windows-reserved device names (case-insensitive, checked against the stem).
const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Sanitize a user-supplied filename (WITHOUT extension — yt-dlp appends
/// `.%(ext)s`). Returns `Err` only when nothing usable remains.
pub fn sanitize(input: &str) -> Result<String, String> {
    let mut out = String::with_capacity(input.len());
    for c in input.chars() {
        let mapped = match c {
            // Path separators and Windows-forbidden characters.
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            // Control characters.
            c if (c as u32) < 0x20 || c as u32 == 0x7f => '_',
            c => c,
        };
        out.push(mapped);
        if out.chars().count() >= MAX_LEN_CHARS {
            break;
        }
    }

    // Trim leading/trailing whitespace and dots (Windows strips trailing
    // dots/spaces silently, which could collide or confuse users).
    let trimmed: String = out.trim().trim_matches('.').trim().to_string();

    if trimmed.is_empty() || trimmed.chars().all(|c| c == '_' || c.is_whitespace()) {
        return Err("filename_empty".into());
    }

    // Reserved device names: compare the stem (part before the first dot),
    // case-insensitively. "CON", "con.mp4" are both invalid targets.
    let stem = trimmed.split('.').next().unwrap_or("");
    if RESERVED.iter().any(|r| stem.eq_ignore_ascii_case(r)) {
        return Ok(format!("_{trimmed}"));
    }

    Ok(trimmed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_names_pass_through() {
        assert_eq!(sanitize("My Video").unwrap(), "My Video");
        assert_eq!(sanitize("clip_01 (final)").unwrap(), "clip_01 (final)");
    }

    #[test]
    fn traversal_is_neutralized() {
        let s = sanitize(r"..\..\Windows\evil").unwrap();
        assert!(!s.contains('\\') && !s.contains('/'));
        // Leading dots trimmed, separators replaced.
        assert!(!s.starts_with('.'));

        let s2 = sanitize("../../etc/passwd").unwrap();
        assert!(!s2.contains('/'));
    }

    #[test]
    fn forbidden_chars_replaced() {
        let s = sanitize(r#"a<b>c:d"e/f\g|h?i*j"#).unwrap();
        assert_eq!(s, "a_b_c_d_e_f_g_h_i_j");
    }

    #[test]
    fn reserved_names_prefixed() {
        assert_eq!(sanitize("CON").unwrap(), "_CON");
        assert_eq!(sanitize("con").unwrap(), "_con");
        assert_eq!(sanitize("Nul.tar").unwrap(), "_Nul.tar");
        assert_eq!(sanitize("lpt9").unwrap(), "_lpt9");
        // Not reserved: substring only.
        assert_eq!(sanitize("CONSOLE").unwrap(), "CONSOLE");
    }

    #[test]
    fn control_chars_and_trailing_dots() {
        assert_eq!(sanitize("bad\u{0007}name...").unwrap(), "bad_name");
        assert_eq!(sanitize("  spaced  ").unwrap(), "spaced");
    }

    #[test]
    fn empty_and_degenerate_rejected() {
        assert!(sanitize("").is_err());
        assert!(sanitize("   ").is_err());
        assert!(sanitize("...").is_err());
        assert!(sanitize("///\\\\").is_err());
        assert!(sanitize("???").is_err());
    }

    #[test]
    fn unicode_preserved() {
        assert_eq!(sanitize("動画テスト🎬").unwrap(), "動画テスト🎬");
        assert_eq!(sanitize("café – naïve").unwrap(), "café – naïve");
    }

    #[test]
    fn long_input_capped_at_200_chars() {
        let long: String = "x".repeat(500);
        let s = sanitize(&long).unwrap();
        assert_eq!(s.chars().count(), 200);
        // Multi-byte safety: no panic, valid UTF-8 by construction.
        let long_uni: String = "é".repeat(500);
        assert_eq!(sanitize(&long_uni).unwrap().chars().count(), 200);
    }
}
