use aws_config::Region;
use aws_credential_types::Credentials;
use aws_sdk_ec2::Client as Ec2Client;
use aws_sdk_costexplorer::Client as CeClient;
use aws_sdk_ecs::Client as EcsClient;
use aws_sdk_applicationautoscaling::Client as AasClient;
use aws_sdk_applicationautoscaling::types::ServiceNamespace;
use aws_sdk_cloudwatchlogs::Client as CwlClient;
use aws_sdk_costexplorer::operation::get_cost_and_usage::GetCostAndUsageOutput;
use aws_sdk_costexplorer::types::{
    DateInterval, Granularity, Group, GroupDefinition, GroupDefinitionType, ResultByTime,
};
use aws_sdk_sts::Client as StsClient;
use aws_smithy_runtime::client::http::hyper_014::HyperClientBuilder;
use aws_smithy_runtime_api::client::http::SharedHttpClient;
use aws_smithy_types::error::metadata::ProvideErrorMetadata;
use serde::{Deserialize, Serialize};
use chrono::{Datelike, Local};

// ─── エラーフォーマットヘルパー ──────────────────────────────────────────────────

/// AWS SDK エラーからコードとメッセージを抽出して人間が読みやすい文字列を返す
fn fmt_aws_err<E: ProvideErrorMetadata + std::fmt::Debug>(label: &str, e: &E) -> String {
    let code = e.code().unwrap_or("UnknownError");
    let msg = e.message().unwrap_or("no message");
    eprintln!("[ERROR] {}: {} - {} | debug: {:?}", label, code, msg, e);
    format!("{}: {} - {}", label, code, msg)
}

// ─── データ型定義 ──────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct AwsCredentials {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub region: String,
    #[serde(default)]
    pub role_arn: Option<String>,
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

#[derive(Serialize, Deserialize)]
pub struct EcsCluster {
    pub cluster_arn: String,
    pub cluster_name: String,
    pub status: String,
    pub running_tasks_count: i32,
    pub pending_tasks_count: i32,
    pub active_services_count: i32,
}

#[derive(Serialize, Deserialize)]
pub struct EcsService {
    pub service_arn: String,
    pub service_name: String,
    pub cluster_arn: String,
    pub status: String,
    pub desired_count: i32,
    pub running_count: i32,
    pub pending_count: i32,
    pub min_capacity: Option<i32>,
    pub max_capacity: Option<i32>,
}

#[derive(Serialize, Deserialize)]
pub struct CloudWatchLogGroup {
    pub log_group_name: String,
    pub stored_bytes: i64,
    pub retention_in_days: Option<i32>,
}

#[derive(Serialize, Deserialize)]
pub struct CloudWatchLogEvent {
    pub timestamp: i64,
    pub message: String,
    pub log_stream_name: String,
}

// ─── AWS クライアント構築 ────────────────────────────────────────────────────────

fn create_http_client() -> SharedHttpClient {
    let https_connector = hyper_rustls::HttpsConnectorBuilder::new()
        .with_webpki_roots()
        .https_or_http()
        .enable_http1()
        .enable_http2()
        .build();

    HyperClientBuilder::new().build(https_connector)
}

/// クレデンシャルを解決する。
/// role_arn が指定されている場合は STS AssumeRole で一時クレデンシャルを取得する。
/// 指定されていない場合は元のアクセスキーをそのまま返す。
async fn resolve_credentials(creds: &AwsCredentials) -> Result<Credentials, String> {
    let base_credentials = Credentials::from_keys(
        &creds.access_key_id,
        &creds.secret_access_key,
        None,
    );

    // role_arn が空でなければ AssumeRole を実行
    let role_arn = creds.role_arn.as_deref().unwrap_or("").trim();
    if role_arn.is_empty() {
        return Ok(base_credentials);
    }

    // STS クライアントを元のクレデンシャルで構築
    let http_client = create_http_client();
    let sts_config = aws_config::from_env()
        .credentials_provider(base_credentials)
        .region(Region::new(creds.region.clone()))
        .http_client(http_client)
        .load()
        .await;
    let sts_client = StsClient::new(&sts_config);

    // AssumeRole 実行
    let assume_resp = sts_client
        .assume_role()
        .role_arn(role_arn)
        .role_session_name("ec2-manager-session")
        .send()
        .await
        .map_err(|e| fmt_aws_err("STS AssumeRole", &e))?;

    let sts_creds = assume_resp
        .credentials()
        .ok_or_else(|| "AssumeRole returned no credentials".to_string())?;

    let access_key = sts_creds.access_key_id().to_string();
    let secret_key = sts_creds.secret_access_key().to_string();
    let session_token = sts_creds.session_token().to_string();

    Ok(Credentials::from_keys(
        access_key,
        secret_key,
        Some(session_token),
    ))
}

/// 指定リージョンで AWS SDK の SdkConfig を構築する
async fn build_sdk_config(creds: &AwsCredentials, region: &str) -> Result<aws_config::SdkConfig, String> {
    let credentials = resolve_credentials(creds).await?;
    let http_client = create_http_client();
    let config = aws_config::from_env()
        .credentials_provider(credentials)
        .region(Region::new(region.to_string()))
        .http_client(http_client)
        .load()
        .await;
    Ok(config)
}

async fn build_ec2_client(creds: &AwsCredentials) -> Result<Ec2Client, String> {
    let config = build_sdk_config(creds, &creds.region).await?;
    Ok(Ec2Client::new(&config))
}

async fn build_ce_client(creds: &AwsCredentials) -> Result<CeClient, String> {
    let config = build_sdk_config(creds, "us-east-1").await?;
    Ok(CeClient::new(&config))
}

async fn build_ecs_client(creds: &AwsCredentials) -> Result<EcsClient, String> {
    let config = build_sdk_config(creds, &creds.region).await?;
    Ok(EcsClient::new(&config))
}

async fn build_aas_client(creds: &AwsCredentials) -> Result<AasClient, String> {
    let config = build_sdk_config(creds, &creds.region).await?;
    Ok(AasClient::new(&config))
}

async fn build_cwl_client(creds: &AwsCredentials) -> Result<CwlClient, String> {
    let config = build_sdk_config(creds, &creds.region).await?;
    Ok(CwlClient::new(&config))
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

// ─── Tauri コマンド (EC2) ──────────────────────────────────────────────────────

#[tauri::command]
async fn list_instances(creds: AwsCredentials) -> Result<Vec<Ec2Instance>, String> {
    let client = build_ec2_client(&creds).await?;

    let resp = client
        .describe_instances()
        .send()
        .await
        .map_err(|e| fmt_aws_err("EC2 DescribeInstances", &e))?;

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
    let client = build_ec2_client(&creds).await?;

    client
        .start_instances()
        .instance_ids(&instance_id)
        .send()
        .await
        .map_err(|e| fmt_aws_err(&format!("EC2 StartInstances ({})", instance_id), &e))?;

    Ok(format!("Instance {} start request sent.", instance_id))
}

#[tauri::command]
async fn stop_instance(creds: AwsCredentials, instance_id: String) -> Result<String, String> {
    let client = build_ec2_client(&creds).await?;

    client
        .stop_instances()
        .instance_ids(&instance_id)
        .send()
        .await
        .map_err(|e| fmt_aws_err(&format!("EC2 StopInstances ({})", instance_id), &e))?;

    Ok(format!("Instance {} stop request sent.", instance_id))
}

// ─── Tauri コマンド (Cost) ─────────────────────────────────────────────────────

#[tauri::command]
async fn get_monthly_cost(creds: AwsCredentials) -> Result<MonthlyCostSummary, String> {
    let client = build_ce_client(&creds).await?;

    let now = Local::now();
    let start = format!("{}-{:02}-01", now.year(), now.month());
    let end = format!("{}-{:02}-{:02}", now.year(), now.month(), now.day());

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
        .map_err(|e| fmt_aws_err("CostExplorer GetCostAndUsage", &e))?;

    let mut by_service: Vec<CostEntry> = Vec::new();
    let mut total_amount = 0.0f64;
    let mut unit = "USD".to_string();

    let results: Vec<ResultByTime> = resp.results_by_time.unwrap_or_default();
    for result in &results {
        let groups: &[Group] = result.groups();
        process_groups(groups, &mut by_service, &mut total_amount, &mut unit);
    }

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

// ─── Tauri コマンド (ECS) ──────────────────────────────────────────────────────

#[tauri::command]
async fn list_ecs_clusters(creds: AwsCredentials) -> Result<Vec<EcsCluster>, String> {
    let client = build_ecs_client(&creds).await?;

    // クラスターARN一覧を取得
    let list_resp = client
        .list_clusters()
        .send()
        .await
        .map_err(|e| fmt_aws_err("ECS ListClusters", &e))?;

    let cluster_arns: Vec<String> = list_resp.cluster_arns().to_vec();
    if cluster_arns.is_empty() {
        return Ok(vec![]);
    }

    // クラスター詳細を取得
    let mut describe_req = client.describe_clusters();
    for arn in &cluster_arns {
        describe_req = describe_req.clusters(arn);
    }

    let desc_resp = describe_req
        .send()
        .await
        .map_err(|e| fmt_aws_err("ECS DescribeClusters", &e))?;

    let clusters: Vec<EcsCluster> = desc_resp
        .clusters()
        .iter()
        .map(|c| EcsCluster {
            cluster_arn: c.cluster_arn().unwrap_or("").to_string(),
            cluster_name: c.cluster_name().unwrap_or("").to_string(),
            status: c.status().unwrap_or("").to_string(),
            running_tasks_count: c.running_tasks_count(),
            pending_tasks_count: c.pending_tasks_count(),
            active_services_count: c.active_services_count(),
        })
        .collect();

    Ok(clusters)
}

#[tauri::command]
async fn list_ecs_services(
    creds: AwsCredentials,
    cluster_arn: String,
) -> Result<Vec<EcsService>, String> {
    let ecs_client = build_ecs_client(&creds).await?;
    let aas_client = build_aas_client(&creds).await?;

    // サービスARN一覧を取得
    let list_resp = ecs_client
        .list_services()
        .cluster(&cluster_arn)
        .send()
        .await
        .map_err(|e| fmt_aws_err(&format!("ECS ListServices (cluster={})", cluster_arn), &e))?;

    let service_arns: Vec<String> = list_resp.service_arns().to_vec();
    if service_arns.is_empty() {
        return Ok(vec![]);
    }

    // サービス詳細を取得（最大10件ずつ）
    let mut all_services: Vec<aws_sdk_ecs::types::Service> = Vec::new();
    for chunk in service_arns.chunks(10) {
        let mut desc_req = ecs_client.describe_services().cluster(&cluster_arn);
        for arn in chunk {
            desc_req = desc_req.services(arn);
        }
        let desc_resp = desc_req
            .send()
            .await
            .map_err(|e| fmt_aws_err(&format!("ECS DescribeServices (cluster={})", cluster_arn), &e))?;
        all_services.extend(desc_resp.services().to_vec());
    }

    // ApplicationAutoScaling のスケーラブルターゲットを取得
    let resource_ids: Vec<String> = all_services
        .iter()
        .filter_map(|s| {
            let cluster_name = cluster_arn.split('/').last().unwrap_or(&cluster_arn);
            let service_name = s.service_name()?;
            Some(format!("service/{}/{}", cluster_name, service_name))
        })
        .collect();

    // スケーラブルターゲット一覧を取得
    let mut scaling_map: std::collections::HashMap<String, (i32, i32)> =
        std::collections::HashMap::new();

    if !resource_ids.is_empty() {
        let mut aas_req = aas_client
            .describe_scalable_targets()
            .service_namespace(ServiceNamespace::Ecs)
            .scalable_dimension(aws_sdk_applicationautoscaling::types::ScalableDimension::EcsServiceDesiredCount);

        for rid in &resource_ids {
            aas_req = aas_req.resource_ids(rid);
        }

        if let Ok(aas_resp) = aas_req.send().await {
            for target in aas_resp.scalable_targets() {
                let rid = target.resource_id().to_string();
                let min = target.min_capacity();
                let max = target.max_capacity();
                scaling_map.insert(rid, (min, max));
            }
        }
    }

    // EcsService 型に変換
    let services: Vec<EcsService> = all_services
        .iter()
        .map(|s| {
            let service_name = s.service_name().unwrap_or("").to_string();
            let cluster_name = cluster_arn.split('/').last().unwrap_or(&cluster_arn);
            let resource_id = format!("service/{}/{}", cluster_name, service_name);
            let (min_capacity, max_capacity) = scaling_map
                .get(&resource_id)
                .map(|(min, max)| (Some(*min), Some(*max)))
                .unwrap_or((None, None));

            EcsService {
                service_arn: s.service_arn().unwrap_or("").to_string(),
                service_name,
                cluster_arn: s.cluster_arn().unwrap_or("").to_string(),
                status: s.status().unwrap_or("").to_string(),
                desired_count: s.desired_count(),
                running_count: s.running_count(),
                pending_count: s.pending_count(),
                min_capacity,
                max_capacity,
            }
        })
        .collect();

    Ok(services)
}

#[tauri::command]
async fn update_ecs_service(
    creds: AwsCredentials,
    cluster_arn: String,
    service_name: String,
    desired_count: i32,
    min_capacity: i32,
    max_capacity: i32,
) -> Result<String, String> {
    let ecs_client = build_ecs_client(&creds).await?;
    let aas_client = build_aas_client(&creds).await?;

    // ApplicationAutoScaling の min/max を先に更新
    let cluster_name = cluster_arn.split('/').last().unwrap_or(&cluster_arn);
    let resource_id = format!("service/{}/{}", cluster_name, service_name);

    // スケーラブルターゲットが存在するか確認してから更新
    let aas_check = aas_client
        .describe_scalable_targets()
        .service_namespace(ServiceNamespace::Ecs)
        .scalable_dimension(aws_sdk_applicationautoscaling::types::ScalableDimension::EcsServiceDesiredCount)
        .resource_ids(&resource_id)
        .send()
        .await;

    if let Ok(check_resp) = aas_check {
        if !check_resp.scalable_targets().is_empty() {
            // スケーラブルターゲットが存在する場合は min/max を更新
            aas_client
                .register_scalable_target()
                .service_namespace(ServiceNamespace::Ecs)
                .scalable_dimension(aws_sdk_applicationautoscaling::types::ScalableDimension::EcsServiceDesiredCount)
                .resource_id(&resource_id)
                .min_capacity(min_capacity)
                .max_capacity(max_capacity)
                .send()
                .await
                .map_err(|e| fmt_aws_err(&format!("ApplicationAutoScaling RegisterScalableTarget ({})", resource_id), &e))?;
        }
    }

    // ECS サービスの desired count を更新
    ecs_client
        .update_service()
        .cluster(&cluster_arn)
        .service(&service_name)
        .desired_count(desired_count)
        .send()
        .await
        .map_err(|e| fmt_aws_err(&format!("ECS UpdateService (service={}, cluster={})", service_name, cluster_arn), &e))?;

    Ok(format!(
        "Service {} updated: desiredCount={}, min={}, max={}",
        service_name, desired_count, min_capacity, max_capacity
    ))
}

// ─── Tauri コマンド (CloudWatch Logs) ─────────────────────────────────────────

/// ECSサービス名に関連するロググループ一覧を取得する
/// プレフィックス: /ecs/<service_name> でフィルタリング
#[tauri::command]
async fn list_ecs_log_groups(
    creds: AwsCredentials,
    service_name: String,
) -> Result<Vec<CloudWatchLogGroup>, String> {
    let client = build_cwl_client(&creds).await?;

    // /ecs/<service_name> をプレフィックスにして検索
    let prefix = format!("/ecs/{}", service_name);
    let resp = client
        .describe_log_groups()
        .log_group_name_prefix(&prefix)
        .limit(50)
        .send()
        .await
        .map_err(|e| fmt_aws_err("CloudWatchLogs DescribeLogGroups", &e))?;

    let groups: Vec<CloudWatchLogGroup> = resp
        .log_groups()
        .iter()
        .map(|g| CloudWatchLogGroup {
            log_group_name: g.log_group_name().unwrap_or("").to_string(),
            stored_bytes: g.stored_bytes().unwrap_or(0),
            retention_in_days: g.retention_in_days(),
        })
        .collect();

    Ok(groups)
}

/// 指定ロググループの最新ログイベントを取得する
/// 複数のログストリームから直近のイベントをまとめて返す
#[tauri::command]
async fn get_ecs_log_events(
    creds: AwsCredentials,
    log_group_name: String,
    limit: i32,
) -> Result<Vec<CloudWatchLogEvent>, String> {
    let client = build_cwl_client(&creds).await?;

    // 直近のログストリームを取得（最新順）
    let streams_resp = client
        .describe_log_streams()
        .log_group_name(&log_group_name)
        .order_by(aws_sdk_cloudwatchlogs::types::OrderBy::LastEventTime)
        .descending(true)
        .limit(5)
        .send()
        .await
        .map_err(|e| fmt_aws_err("CloudWatchLogs DescribeLogStreams", &e))?;

    let streams = streams_resp.log_streams();
    if streams.is_empty() {
        return Ok(vec![]);
    }

    let per_stream_limit = std::cmp::max(1, limit / streams.len() as i32);
    let mut all_events: Vec<CloudWatchLogEvent> = Vec::new();

    for stream in streams {
        let stream_name = match stream.log_stream_name() {
            Some(n) => n.to_string(),
            None => continue,
        };

        let events_resp = client
            .get_log_events()
            .log_group_name(&log_group_name)
            .log_stream_name(&stream_name)
            .limit(per_stream_limit)
            .start_from_head(false)
            .send()
            .await;

        if let Ok(resp) = events_resp {
            for ev in resp.events() {
                all_events.push(CloudWatchLogEvent {
                    timestamp: ev.timestamp().unwrap_or(0),
                    message: ev.message().unwrap_or("").trim_end().to_string(),
                    log_stream_name: stream_name.clone(),
                });
            }
        }
    }

    // タイムスタンプ降順でソート
    all_events.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    all_events.truncate(limit as usize);

    Ok(all_events)
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
            list_ecs_clusters,
            list_ecs_services,
            update_ecs_service,
            list_ecs_log_groups,
            get_ecs_log_events,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
