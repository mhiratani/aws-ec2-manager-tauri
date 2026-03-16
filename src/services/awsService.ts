import { invoke } from '@tauri-apps/api/core';
import { AwsCredentials, Ec2Instance, MonthlyCostSummary } from '../types';

// Tauriコマンド用のクレデンシャル変換（snake_case）
function toRustCreds(creds: AwsCredentials) {
  return {
    access_key_id: creds.accessKeyId,
    secret_access_key: creds.secretAccessKey,
    region: creds.region,
  };
}

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

export async function getMonthlyCost(creds: AwsCredentials): Promise<MonthlyCostSummary> {
  return invoke<MonthlyCostSummary>('get_monthly_cost', { creds: toRustCreds(creds) });
}
