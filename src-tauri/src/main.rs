// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use reqwest::Client;
use serde::Serialize;
use serde::Deserialize;
use std::env;
use dotenv::dotenv;
use std::collections::HashMap;
use std::sync::Mutex;
use once_cell::sync::Lazy;
use std::fs;
use std::fs::File;
use std::io::{self, Read, Write, BufReader};

static TRANSLATE_CACHE: Lazy<Mutex<HashMap<String, String>>> = Lazy::new(|| {
    Mutex::new(HashMap::new())
});

#[derive(Debug, Serialize, Deserialize)]
pub struct Translation {
    detected_source_language: String,
    text: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranslationResponse {
    translations: Vec<Translation>,
}

#[tauri::command]
fn translate_into_jananese(phrase: &str) -> Result<String, String> {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async_translate_into_jananese(phrase))
}

async fn async_translate_into_jananese(phrase: &str) -> Result<String, String> {
    let mut cache = TRANSLATE_CACHE.lock().unwrap();

    // キャッシュに引っかかったらそれを返す
    if let Some(ja_phrase) = cache.get(phrase).cloned() {
        println!("cache hit! {} -> {}", phrase, ja_phrase);
        return Ok(ja_phrase);
    }

    // キャッシュになかったらDeepLを使って翻訳する
    let deepl_auth_key = env::var("DEEPL_AUTH_KEY").expect("DEEPL_AUTH_KEY is not defined");
    let client = Client::new();
    let url = "https://api-free.deepl.com/v2/translate";
    let params = [
        ("text", phrase),
        ("source_lang", "EN"),
        ("target_lang", "JA"),
    ];
    let result = client
        .post(url)
        .header("Authorization", format!("DeepL-Auth-Key {}", deepl_auth_key))
        .form(&params)
        .send()
        .await;
    match result {
        Ok(response) => {
            let res = parse_response(response).await?;
            println!("{:?}", res);
            println!("{}", res.translations[0].text);
            if res.translations.len() > 0 {
                let ja_phrase = res.translations[0].text.clone();
                cache.insert(phrase.to_string(), ja_phrase.clone());
                return Ok(ja_phrase);
            }
            return Err("no translation".to_string());
        },
        Err(_) => return Err("post error".to_string())
    }
}

// async fn async_translate_into_jananese(phrase: &str) -> Result<String, String> {
//     Ok("ダミー翻訳".to_string())
// }

#[tauri::command]
fn save(file_name: &str, json_str: &str) {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async_save(file_name, json_str))
}

async fn async_save(file_name: &str, json_str: &str) {
    let mut file = File::create(file_name);
    match file {
        Ok(mut f) => {
            match f.write_all(json_str.as_bytes()) {
                Ok(_) => println!("save success"),
                Err(_) => println!("save error")
            }
        },
        Err(_) => println!("file create error")
    }
}

#[tauri::command]
fn load(file_name: &str) -> Result<String, String> {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async_load(file_name))
}

async fn async_load(file_name: &str) -> Result<String, String> {
    let content = fs::read_to_string(file_name);
    match content {
        Ok(f) => {
            return Ok(f);
        },
        Err(_) => println!("file read error")
    }
    
    Err("unknown error".to_string())
}

async fn parse_response(response: reqwest::Response) -> Result<TranslationResponse, String> {
    let res = response.json::<TranslationResponse>().await;
    match res {
        Ok(body) => Ok(body),
        Err(_) => Err("json error".to_string())
    }
}

fn main() {
    dotenv().ok();
    tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![translate_into_jananese, save, load])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
