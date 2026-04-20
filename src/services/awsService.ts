import { invoke } from '@tauri-apps/api/core';
import { AwsCredentials, Ec2Instance, MonthlyCostSummary, EcsCluster, EcsService, CloudWatchLogGroup, CloudWatchLogEvent } from '../types';

// Tauriコマンド用のクレデンシャル変換（snake_case）
function toRustCreds(creds: AwsCredentials) {
  return {
    access_key_id: creds.accessKeyId,
    secret_access_key: creds.secretAccessKey,
    region: creds.region,
    role_arn: creds.roleArn || null,
  };
}

/**
 * Tauri invoke のラッパー。
 * 呼び出し前後と失敗時にコンソールへログを出力する。
 */
async function invokeWithLog<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  console.log(`[AWS] invoke start: ${cmd}`, args);
  try {
    const result = await invoke<T>(cmd, args);
    console.log(`[AWS] invoke success: ${cmd}`, result);
    return result;
  } catch (e) {
    console.error(`[AWS] invoke error: ${cmd}`, e);
    throw e;
  }
}

// ─── EC2 ─────────────────────────────────────────────────────────────────────

export async function listInstances(creds: AwsCredentials): Promise<Ec2Instance[]> {
  return invokeWithLog<Ec2Instance[]>('list_instances', { creds: toRustCreds(creds) });
}

export async function startInstance(creds: AwsCredentials, instanceId: string): Promise<string> {
  return invokeWithLog<string>('start_instance', {
    creds: toRustCreds(creds),
    instanceId: instanceId,
  });
}

export async function stopInstance(creds: AwsCredentials, instanceId: string): Promise<string> {
  return invokeWithLog<string>('stop_instance', {
    creds: toRustCreds(creds),
    instanceId: instanceId,
  });
}

// ─── Cost ────────────────────────────────────────────────────────────────────

export async function getMonthlyCost(creds: AwsCredentials): Promise<MonthlyCostSummary> {
  return invokeWithLog<MonthlyCostSummary>('get_monthly_cost', { creds: toRustCreds(creds) });
}

// ─── ECS ─────────────────────────────────────────────────────────────────────

/**
 * ECSクラスター一覧を取得する
 */
export async function listEcsClusters(creds: AwsCredentials): Promise<EcsCluster[]> {
  return invokeWithLog<EcsCluster[]>('list_ecs_clusters', { creds: toRustCreds(creds) });
}

/**
 * ECSサービス一覧を取得する（Auto Scalingのmin/max値を含む）
 */
export async function listEcsServices(
  creds: AwsCredentials,
  clusterArn: string
): Promise<EcsService[]> {
  return invokeWithLog<EcsService[]>('list_ecs_services', {
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
  return invokeWithLog<string>('update_ecs_service', {
    creds: toRustCreds(creds),
    clusterArn,
    serviceName,
    desiredCount,
    minCapacity,
    maxCapacity,
  });
}

// ─── CloudWatch Logs ──────────────────────────────────────────────────────────

/**
 * ECSサービス名に関連するロググループ一覧を取得する（/ecs/<serviceName> プレフィックス）
 */
export async function listEcsLogGroups(
  creds: AwsCredentials,
  serviceName: string
): Promise<CloudWatchLogGroup[]> {
  return invokeWithLog<CloudWatchLogGroup[]>('list_ecs_log_groups', {
    creds: toRustCreds(creds),
    serviceName,
  });
}

/**
 * 指定ロググループの最新ログイベントを取得する
 */
export async function getEcsLogEvents(
  creds: AwsCredentials,
  logGroupName: string,
  limit: number = 100
): Promise<CloudWatchLogEvent[]> {
  return invokeWithLog<CloudWatchLogEvent[]>('get_ecs_log_events', {
    creds: toRustCreds(creds),
    logGroupName,
    limit,
  });
}
