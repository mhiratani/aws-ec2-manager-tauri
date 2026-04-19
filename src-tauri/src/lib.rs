use aws_config::Region;
use aws_credential_types::Credentials;
use aws_sdk_ec2::Client as Ec2Client;
use aws_sdk_costexplorer::Client as CeClient;
use aws_sdk_ecs::Client as EcsClient;
use aws_sdk_applicationautoscaling::Client as AasClient;
use aws_sdk_applicationautoscaling::types::ServiceNamespace;
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
    let config = aws_config::from_env()
        .credentials_provider(credentials)
        .region(Region::new("us-east-1".to_string()))
        .http_client(http_client)
        .load()
        .await;
    CeClient::new(&config)
}

async fn build_ecs_client(creds: &AwsCredentials) -> EcsClient {
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
    EcsClient::new(&config)
}

async fn build_aas_client(creds: &AwsCredentials) -> AasClient {
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
    AasClient::new(&config)
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

// ─── Tauri コマンド (Cost) ─────────────────────────────────────────────────────

#[tauri::command]
async fn get_monthly_cost(creds: AwsCredentials) -> Result<MonthlyCostSummary, String> {
    let client = build_ce_client(&creds).await;

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
        .map_err(|e| format!("GetCostAndUsage error: {}", e))?;

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
    let client = build_ecs_client(&creds).await;

    // クラスターARN一覧を取得
    let list_resp = client
        .list_clusters()
        .send()
        .await
        .map_err(|e| format!("ECS ListClusters error: {}", e))?;

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
        .map_err(|e| format!("ECS DescribeClusters error: {}", e))?;

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
    let ecs_client = build_ecs_client(&creds).await;
    let aas_client = build_aas_client(&creds).await;

    // サービスARN一覧を取得
    let list_resp = ecs_client
        .list_services()
        .cluster(&cluster_arn)
        .send()
        .await
        .map_err(|e| format!("ECS ListServices error: {}", e))?;

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
            .map_err(|e| format!("ECS DescribeServices error: {}", e))?;
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
    let ecs_client = build_ecs_client(&creds).await;
    let aas_client = build_aas_client(&creds).await;

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
                .map_err(|e| format!("ApplicationAutoScaling RegisterScalableTarget error: {}", e))?;
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
        .map_err(|e| format!("ECS UpdateService error: {}", e))?;

    Ok(format!(
        "Service {} updated: desiredCount={}, min={}, max={}",
        service_name, desired_count, min_capacity, max_capacity
    ))
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
