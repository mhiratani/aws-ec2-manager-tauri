export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

// ─── マルチアカウント ──────────────────────────────────────────────────────────

export interface AwsAccount {
  id: string;           // UUID
  name: string;         // 表示名（例: "開発環境", "本番環境"）
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export interface AccountsStorage {
  accounts: AwsAccount[];
  activeAccountId: string | null;
}

// ─── EC2 ─────────────────────────────────────────────────────────────────────

export interface Ec2Instance {
  instance_id: string;
  name: string;
  instance_type: string;
  state: string;
  public_ip: string | null;
  private_ip: string | null;
  availability_zone: string;
  launch_time: string;
}

// ─── ECS ─────────────────────────────────────────────────────────────────────

export interface EcsCluster {
  cluster_arn: string;
  cluster_name: string;
  status: string;
  running_tasks_count: number;
  pending_tasks_count: number;
  active_services_count: number;
}

export interface EcsService {
  service_arn: string;
  service_name: string;
  cluster_arn: string;
  status: string;
  desired_count: number;
  running_count: number;
  pending_count: number;
  min_capacity: number | null;  // Auto Scaling 最小値
  max_capacity: number | null;  // Auto Scaling 最大値
}

// ─── Cost ────────────────────────────────────────────────────────────────────

export interface CostEntry {
  service: string;
  amount: string;
  unit: string;
}

export interface MonthlyCostSummary {
  period_start: string;
  period_end: string;
  total_amount: string;
  unit: string;
  by_service: CostEntry[];
}

// ─── 共通 ────────────────────────────────────────────────────────────────────

export type InstanceState =
  | 'pending'
  | 'running'
  | 'shutting-down'
  | 'terminated'
  | 'stopping'
  | 'stopped'
  | 'unknown';

export const AWS_REGIONS = [
  { value: 'us-east-1', label: 'US East (N. Virginia)' },
  { value: 'us-east-2', label: 'US East (Ohio)' },
  { value: 'us-west-1', label: 'US West (N. California)' },
  { value: 'us-west-2', label: 'US West (Oregon)' },
  { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
  { value: 'ap-northeast-2', label: 'Asia Pacific (Seoul)' },
  { value: 'ap-northeast-3', label: 'Asia Pacific (Osaka)' },
  { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
  { value: 'ap-southeast-2', label: 'Asia Pacific (Sydney)' },
  { value: 'ap-south-1', label: 'Asia Pacific (Mumbai)' },
  { value: 'eu-west-1', label: 'Europe (Ireland)' },
  { value: 'eu-west-2', label: 'Europe (London)' },
  { value: 'eu-west-3', label: 'Europe (Paris)' },
  { value: 'eu-central-1', label: 'Europe (Frankfurt)' },
  { value: 'sa-east-1', label: 'South America (São Paulo)' },
  { value: 'ca-central-1', label: 'Canada (Central)' },
];
