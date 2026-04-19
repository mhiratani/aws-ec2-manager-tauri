import { invoke } from '@tauri-apps/api/core';
import { AwsCredentials, Ec2Instance, MonthlyCostSummary, EcsCluster, EcsService } from '../types';

// Tauriコマンド用のクレデンシャル変換（snake_case）
function toRustCreds(creds: AwsCredentials) {
  return {
    access_key_id: creds.accessKeyId,
    secret_access_key: creds.secretAccessKey,
    region: creds.region,
  };
}

// ─── EC2 ─────────────────────────────────────────────────────────────────────

export async function listInstances(creds: AwsCredentials): Promise<Ec2Instance[]> {
  return invoke<Ec2Instance[]>('list_instances', { creds: toRustCreds(creds) });
}

export async function startInstance(creds: AwsCredentials, instanceId: string): Promise<string> {
  return invoke<string>('start_instance', {
    creds: toRustCreds(creds),
    instanceId: instanceId,
  });
}

export async function stopInstance(creds: AwsCredentials, instanceId: string): Promise<string> {
  return invoke<string>('stop_instance', {
    creds: toRustCreds(creds),
    instanceId: instanceId,
  });
}

// ─── Cost ────────────────────────────────────────────────────────────────────

export async function getMonthlyCost(creds: AwsCredentials): Promise<MonthlyCostSummary> {
  return invoke<MonthlyCostSummary>('get_monthly_cost', { creds: toRustCreds(creds) });
}

// ─── ECS ─────────────────────────────────────────────────────────────────────

/**
 * ECSクラスター一覧を取得する
 */
export async function listEcsClusters(creds: AwsCredentials): Promise<EcsCluster[]> {
  return invoke<EcsCluster[]>('list_ecs_clusters', { creds: toRustCreds(creds) });
}

/**
 * ECSサービス一覧を取得する（Auto Scalingのmin/max値を含む）
 */
export async function listEcsServices(
  creds: AwsCredentials,
  clusterArn: string
): Promise<EcsService[]> {
  return invoke<EcsService[]>('list_ecs_services', {
    creds: toRustCreds(creds),
    clusterArn,
  });
}

/**
 * ECSサービスのdesiredCountとAuto Scalingのmin/maxを更新する
 */
export async function updateEcsService(
  creds: AwsCredentials,
  clusterArn: string,
  serviceName: string,
  desiredCount: number,
  minCapacity: number,
  maxCapacity: number
): Promise<string> {
  return invoke<string>('update_ecs_service', {
    creds: toRustCreds(creds),
    clusterArn,
    serviceName,
    desiredCount,
    minCapacity,
    maxCapacity,
  });
}
