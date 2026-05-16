mod handlers;
#[cfg(windows)]
mod setup;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(windows)]
    {
        builder = builder.manage(crate::window_widget::RestoreBounds::default());
        builder = builder.setup(setup::init);
    }

    builder = handlers::with_invoke_handler(builder);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
