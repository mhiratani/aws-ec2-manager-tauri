use aws_config::Region;
use aws_credential_types::Credentials;
use aws_sdk_ec2::Client as Ec2Client;
use aws_sdk_costexplorer::Client as CeClient;
use aws_sdk_costexplorer::operation::get_cost_and_usage::GetCostAndUsageOutput;
use aws_sdk_costexplorer::types::{
    DateInterval, Granularity, Group, GroupDefinition, GroupDefinitionType, ResultByTime,
};
use aws_smithy_runtime::client::http::hyper_014::HyperClientBuilder;
use aws_smithy_runtime_api::client::http::SharedHttpClient;
use serde::{Deserialize, Serialize};
use chrono::{Datelike, Local};

// ─── データ型定義 ──────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct AwsCredentials {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub region: String,
}

#[derive(Serialize, Deserialize)]
pub struct Ec2Instance {
    pub instance_id: String,
    pub name: String,
    pub instance_type: String,
    pub state: String,
    pub public_ip: Option<String>,
    pub private_ip: Option<String>,
    pub availability_zone: String,
    pub launch_time: String,
}

#[derive(Serialize, Deserialize)]
pub struct CostEntry {
    pub service: String,
    pub amount: String,
    pub unit: String,
}

#[derive(Serialize, Deserialize)]
pub struct MonthlyCostSummary {
    pub period_start: String,
    pub period_end: String,
    pub total_amount: String,
    pub unit: String,
    pub by_service: Vec<CostEntry>,
}

// ─── AWS クライアント構築 ────────────────────────────────────────────────────────

fn create_http_client() -> SharedHttpClient {
    // hyper-rustlsのwebpki-roots機能を使用して証明書を自動設定
    let https_connector = hyper_rustls::HttpsConnectorBuilder::new()
        .with_webpki_roots()
        .https_or_http()
        .enable_http1()
        .enable_http2()
        .build();

    HyperClientBuilder::new().build(https_connector)
}

async fn build_ec2_client(creds: &AwsCredentials) -> Ec2Client {
    let credentials = Credentials::from_keys(
        &creds.access_key_id,
        &creds.secret_access_key,
        None,
    );
    
    let http_client = create_http_client();
    
    let config = aws_config::from_env()
        .credentials_provider(credentials)
        .region(Region::new(creds.region.clone()))
        .http_client(http_client)
        .load()
        .await;
    Ec2Client::new(&config)
}

async fn build_ce_client(creds: &AwsCredentials) -> CeClient {
    let credentials = Credentials::from_keys(
        &creds.access_key_id,
        &creds.secret_access_key,
        None,
    );
    
    let http_client = create_http_client();
    
    // Cost Explorer は us-east-1 のみ
    let config = aws_config::from_env()
        .credentials_provider(credentials)
        .region(Region::new("us-east-1".to_string()))
        .http_client(http_client)
        .load()
        .await;
    CeClient::new(&config)
}

// ─── コスト処理ヘルパー ─────────────────────────────────────────────────────────

fn process_groups(
    groups: &[Group],
    by_service: &mut Vec<CostEntry>,
    total_amount: &mut f64,
    unit: &mut String,
) {
    for group in groups {
        let keys: &[String] = group.keys();
        let service_name: String = keys
            .first()
            .cloned()
            .unwrap_or_else(|| "Unknown".to_string());

        if let Some(metrics_map) = group.metrics() {
            if let Some(cost) = metrics_map.get("UnblendedCost") {
                let amount_val: f64 = cost.amount().unwrap_or("0").parse().unwrap_or(0.0);
                let cost_unit: String = cost.unit().unwrap_or("USD").to_string();
                *unit = cost_unit.clone();
                *total_amount += amount_val;
                by_service.push(CostEntry {
                    service: service_name,
                    amount: format!("{:.4}", amount_val),
                    unit: cost_unit,
                });
            }
        }
    }
}

// ─── Tauri コマンド ────────────────────────────────────────────────────────────

#[tauri::command]
async fn list_instances(creds: AwsCredentials) -> Result<Vec<Ec2Instance>, String> {
    let client = build_ec2_client(&creds).await;

    let resp = client
        .describe_instances()
        .send()
        .await
        .map_err(|e| format!("EC2 DescribeInstances error: {}", e))?;

    let mut instances = Vec::new();

    for reservation in resp.reservations() {
        for inst in reservation.instances() {
            let instance_id = inst.instance_id().unwrap_or("").to_string();
            let state = inst
                .state()
                .and_then(|s| s.name())
                .map(|n| n.as_str().to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let instance_type = inst
                .instance_type()
                .map(|t| t.as_str().to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let public_ip = inst.public_ip_address().map(|s| s.to_string());
            let private_ip = inst.private_ip_address().map(|s| s.to_string());
            let availability_zone = inst
                .placement()
                .and_then(|p| p.availability_zone())
                .unwrap_or("")
                .to_string();
            let launch_time = inst
                .launch_time()
                .map(|t| t.to_string())
                .unwrap_or_else(|| "".to_string());

            // Name タグを取得
            let name = inst
                .tags()
                .iter()
                .find(|t| t.key() == Some("Name"))
                .and_then(|t| t.value())
                .unwrap_or("")
                .to_string();

            instances.push(Ec2Instance {
                instance_id,
                name,
                instance_type,
                state,
                public_ip,
                private_ip,
                availability_zone,
                launch_time,
            });
        }
    }

    Ok(instances)
}

#[tauri::command]
async fn start_instance(creds: AwsCredentials, instance_id: String) -> Result<String, String> {
    let client = build_ec2_client(&creds).await;

    client
        .start_instances()
        .instance_ids(&instance_id)
        .send()
        .await
        .map_err(|e| format!("StartInstances error: {}", e))?;

    Ok(format!("Instance {} start request sent.", instance_id))
}

#[tauri::command]
async fn stop_instance(creds: AwsCredentials, instance_id: String) -> Result<String, String> {
    let client = build_ec2_client(&creds).await;

    client
        .stop_instances()
        .instance_ids(&instance_id)
        .send()
        .await
        .map_err(|e| format!("StopInstances error: {}", e))?;

    Ok(format!("Instance {} stop request sent.", instance_id))
}

#[tauri::command]
async fn get_monthly_cost(creds: AwsCredentials) -> Result<MonthlyCostSummary, String> {
    let client = build_ce_client(&creds).await;

    // 当月の開始日と今日の日付を取得
    let now = Local::now();
    let start = format!("{}-{:02}-01", now.year(), now.month());
    let end = format!("{}-{:02}-{:02}", now.year(), now.month(), now.day());

    // 終了日が開始日と同じ場合（月初の場合）は翌日にする
    let end = if start == end {
        let tomorrow = now + chrono::Duration::days(1);
        format!("{}-{:02}-{:02}", tomorrow.year(), tomorrow.month(), tomorrow.day())
    } else {
        end
    };

    let date_interval = DateInterval::builder()
        .start(&start)
        .end(&end)
        .build()
        .map_err(|e| format!("DateInterval build error: {}", e))?;

    let group_def = GroupDefinition::builder()
        .r#type(GroupDefinitionType::Dimension)
        .key("SERVICE")
        .build();

    let resp: GetCostAndUsageOutput = client
        .get_cost_and_usage()
        .time_period(date_interval)
        .granularity(Granularity::Monthly)
        .metrics("UnblendedCost")
        .group_by(group_def)
        .send()
        .await
        .map_err(|e| format!("GetCostAndUsage error: {}", e))?;

    let mut by_service: Vec<CostEntry> = Vec::new();
    let mut total_amount = 0.0f64;
    let mut unit = "USD".to_string();

    let results: Vec<ResultByTime> = resp.results_by_time.unwrap_or_default();
    for result in &results {
        let groups: &[Group] = result.groups();
        process_groups(groups, &mut by_service, &mut total_amount, &mut unit);
    }

    // コスト順にソート（降順）
    by_service.sort_by(|a, b| {
        let a_val: f64 = a.amount.parse().unwrap_or(0.0);
        let b_val: f64 = b.amount.parse().unwrap_or(0.0);
        b_val.partial_cmp(&a_val).unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(MonthlyCostSummary {
        period_start: start,
        period_end: end,
        total_amount: format!("{:.4}", total_amount),
        unit,
        by_service,
    })
}

// ─── エントリポイント ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_instances,
            start_instance,
            stop_instance,
            get_monthly_cost,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
