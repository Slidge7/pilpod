fn main() {
    // Ensure Windows resource embedding (EXE icon → taskbar) rebuilds whenever
    // bundle artwork changes — avoid stale ICO in pilpod.exe when only icons change.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/32x32.png");
    println!("cargo:rerun-if-changed=icons/128x128.png");
    println!("cargo:rerun-if-changed=icons/128x128@2x.png");
    // Re-copy bundled browser icons (resources) when PNGs are added/replaced.
    println!("cargo:rerun-if-changed=icons/browsers");
    tauri_build::build()
}
