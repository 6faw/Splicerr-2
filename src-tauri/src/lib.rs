#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[tauri::command]
async fn splice_graphql(body: serde_json::Value) -> Result<serde_json::Value, String> {
    const GRAPHQL_URL: &str = "https://surfaces-graphql.splice.com/graphql";
    const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

    let operation_name = body
        .get("operationName")
        .and_then(|value| value.as_str())
        .unwrap_or("SamplesSearch");

    let response = reqwest::Client::new()
        .post(GRAPHQL_URL)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.9")
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .header("apollo-require-preflight", "true")
        .header("x-apollo-operation-name", operation_name)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Splice GraphQL request failed: {error}"))?;

    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|error| format!("Failed to read Splice GraphQL response: {error}"))?;

    if !status.is_success() {
        if response_text.contains("Attention Required") && response_text.contains("Cloudflare") {
            return Err("Splice blocked the GraphQL request with Cloudflare.".to_string());
        }

        let preview = response_text
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        let preview = preview.chars().take(300).collect::<String>();
        return Err(format!("HTTP {} {}", status.as_u16(), preview));
    }

    serde_json::from_str(&response_text)
        .map_err(|error| format!("Failed to parse Splice GraphQL response: {error}"))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_drag::init())
        .invoke_handler(tauri::generate_handler![splice_graphql])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
