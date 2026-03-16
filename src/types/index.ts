export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

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
