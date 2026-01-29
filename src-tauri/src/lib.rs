use std::path::PathBuf;
use std::fs;
use base64::{Engine as _, engine::general_purpose};
use tauri::Manager;

// Application state to store paths
struct AppState {
    image_cache_dir: PathBuf,
}

#[tauri::command]
async fn read_file_as_base64(path: String) -> Result<String, String> {
    // Read file and convert to base64
    let file_data = fs::read(&path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let base64_data = general_purpose::STANDARD.encode(&file_data);
    Ok(base64_data)
}

#[tauri::command]
async fn save_image_to_cache(
    filename: String,
    base64_data: String,
    state: tauri::State<'_, AppState>
) -> Result<String, String> {
    let cache_dir = &state.image_cache_dir;

    // Create cache directory if it doesn't exist
    fs::create_dir_all(cache_dir)
        .map_err(|e| format!("Failed to create cache directory: {}", e))?;

    let file_path = cache_dir.join(&filename);

    // Decode base64 and write to file
    let image_bytes = general_purpose::STANDARD.decode(&base64_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    fs::write(&file_path, image_bytes)
        .map_err(|e| format!("Failed to write image file: {}", e))?;

    Ok(filename)
}

#[tauri::command]
async fn get_image_cache_path(
    filename: String,
    state: tauri::State<'_, AppState>
) -> Result<String, String> {
    let file_path = state.image_cache_dir.join(&filename);
        
    println!("{}",file_path.display());

    // Check if file exists
    if !file_path.exists() {
        return Err(format!("Image not found in cache: {}", filename));
    }

    Ok(file_path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Get app data directory from Tauri (cross-platform)
            let app_data_dir = app.path().app_local_data_dir()
                .expect("Failed to get app data directory");

            let image_cache_dir = app_data_dir.join("image_cache");

            // Store in managed state
            app.manage(AppState {
                image_cache_dir,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file_as_base64,
            save_image_to_cache,
            get_image_cache_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
