//! Extract browser icons from resolved `.exe` paths (Windows Shell APIs).

use std::collections::HashMap;
use std::ffi::{c_void, OsStr};
use std::io::Cursor;
use std::os::windows::ffi::OsStrExt;
use std::sync::{LazyLock, Mutex};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{ImageFormat, RgbaImage};
use windows::core::PCWSTR;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC,
    SelectObject, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HDC,
    HGDIOBJ,
};
use windows::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

static CACHE: LazyLock<Mutex<HashMap<String, Option<String>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// PNG data URL for a catalog browser id, cached for the process lifetime.
pub fn data_url_for_browser(os_browser_id: &str) -> Option<String> {
    let mut cache = CACHE.lock().ok()?;
    if let Some(cached) = cache.get(os_browser_id) {
        return cached.clone();
    }

    let url = icon_data_url_for_browser(os_browser_id);
    cache.insert(os_browser_id.to_string(), url.clone());
    url
}

fn icon_data_url_for_browser(os_browser_id: &str) -> Option<String> {
    let exe = crate::browser_catalog::resolve_exe_path(os_browser_id)?;
    let png = extract_exe_icon_png(&exe)?;
    Some(format!("data:image/png;base64,{}", STANDARD.encode(png)))
}

fn wide_path(path: &str) -> Vec<u16> {
    OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn extract_exe_icon_png(exe_path: &str) -> Option<Vec<u8>> {
    let wide = wide_path(exe_path);
    let mut shfi = SHFILEINFOW::default();

    unsafe {
        let got = SHGetFileInfoW(
            PCWSTR(wide.as_ptr()),
            Default::default(),
            Some(&mut shfi),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        );
        if got == 0 {
            return None;
        }

        let png = hicon_to_png(shfi.hIcon);
        let _ = DestroyIcon(shfi.hIcon);
        png
    }
}

unsafe fn hicon_to_png(icon: HICON) -> Option<Vec<u8>> {
    let mut info = ICONINFO::default();
    GetIconInfo(icon, &mut info).ok()?;

    let hdc = GetDC(None);
    let mem_dc = CreateCompatibleDC(Some(hdc));

    let png = hicon_to_png_inner(mem_dc, info.hbmColor, info.hbmMask);

    let _ = DeleteDC(mem_dc);
    let _ = ReleaseDC(None, hdc);
    let _ = DeleteObject(info.hbmColor.into());
    let _ = DeleteObject(info.hbmMask.into());

    png
}

unsafe fn hicon_to_png_inner(mem_dc: HDC, color: HBITMAP, mask: HBITMAP) -> Option<Vec<u8>> {
    let mut bmp = BITMAP::default();
    GetObjectW(
        HGDIOBJ::from(color),
        std::mem::size_of::<BITMAP>() as i32,
        Some(&mut bmp as *mut _ as *mut c_void),
    );

    let width = bmp.bmWidth as u32;
    let height = bmp.bmHeight as u32;
    if width == 0 || height == 0 {
        return None;
    }

    let old = SelectObject(mem_dc, HGDIOBJ::from(color));

    let mut bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: -(height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };

    let mut pixels = vec![0u8; (width * height * 4) as usize];
    let rows = GetDIBits(
        mem_dc,
        color,
        0,
        height,
        Some(pixels.as_mut_ptr() as *mut c_void),
        &mut bmi,
        DIB_RGB_COLORS,
    );
    if rows == 0 {
        let _ = SelectObject(mem_dc, old);
        return None;
    }

    apply_and_mask(mem_dc, mask, width, height, &mut pixels);

    let _ = SelectObject(mem_dc, old);

    // BGRA → RGBA
    for px in pixels.chunks_exact_mut(4) {
        px.swap(0, 2);
    }

    let img = RgbaImage::from_raw(width, height, pixels)?;
    let mut buf = Vec::new();
    img.write_to(&mut Cursor::new(&mut buf), ImageFormat::Png).ok()?;
    Some(buf)
}

unsafe fn apply_and_mask(mem_dc: HDC, mask: HBITMAP, width: u32, height: u32, pixels: &mut [u8]) {
    if mask.0.is_null() {
        return;
    }

    let mut mask_bmp = BITMAP::default();
    GetObjectW(
        HGDIOBJ::from(mask),
        std::mem::size_of::<BITMAP>() as i32,
        Some(&mut mask_bmp as *mut _ as *mut c_void),
    );

    // Icon masks are double-height: top = AND, bottom = XOR.
    let mask_height = (mask_bmp.bmHeight / 2).max(height as i32) as u32;
    let row_bytes = ((width + 31) / 32) * 4;

    let mut mask_bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: -(mask_height as i32),
            biPlanes: 1,
            biBitCount: 1,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };

    let mut mask_rows = vec![0u8; (row_bytes * mask_height) as usize];
    let old = SelectObject(mem_dc, HGDIOBJ::from(mask));
    let got = GetDIBits(
        mem_dc,
        mask,
        0,
        mask_height,
        Some(mask_rows.as_mut_ptr() as *mut c_void),
        &mut mask_bmi,
        DIB_RGB_COLORS,
    );
    let _ = SelectObject(mem_dc, old);
    if got == 0 {
        return;
    }

    for y in 0..height {
        for x in 0..width {
            let byte = mask_rows[(y * row_bytes + x / 8) as usize];
            let bit = (byte >> (7 - (x % 8))) & 1;
            let idx = ((y * width + x) * 4) as usize;
            if bit == 1 {
                pixels[idx + 3] = 0;
            } else if pixels[idx + 3] == 0 {
                pixels[idx + 3] = 255;
            }
        }
    }
}
