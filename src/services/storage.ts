import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import CryptoJS from 'crypto-js';
import { AwsCredentials } from '../types';

const CREDENTIALS_FILE = 'aws-credentials.json';
const ENCRYPTION_KEY = 'aws-ec2-manager-secret-key-2024';

/**
 * クレデンシャルファイルのフルパスを取得
 * tomato-doughnut-tauri と同様に appDataDir + join を使用
 * Androidでは /data/data/<package>/files/ に保存される（外部ストレージアクセス不要）
 */
const getCredentialsPath = async (): Promise<string> => {
  const dataDir = await appDataDir();
  // ディレクトリが存在しない場合は作成
  const dirExists = await exists(dataDir);
  if (!dirExists) {
    await mkdir(dataDir, { recursive: true });
  }
  return await join(dataDir, CREDENTIALS_FILE);
};

export async function saveCredentials(creds: AwsCredentials): Promise<void> {
  const json = JSON.stringify(creds);
  const encrypted = CryptoJS.AES.encrypt(json, ENCRYPTION_KEY).toString();
  const path = await getCredentialsPath();
  await writeTextFile(path, encrypted);
}

export async function loadCredentials(): Promise<AwsCredentials | null> {
  try {
    const path = await getCredentialsPath();
    const fileExists = await exists(path);
    if (!fileExists) return null;

    const encrypted = await readTextFile(path);
    if (!encrypted || encrypted.trim() === '') return null;

    const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
    const json = bytes.toString(CryptoJS.enc.Utf8);
    if (!json) return null;
    return JSON.parse(json) as AwsCredentials;
  } catch {
    return null;
  }
}

export async function clearCredentials(): Promise<void> {
  try {
    const path = await getCredentialsPath();
    const fileExists = await exists(path);
    if (fileExists) {
      await writeTextFile(path, '');
    }
  } catch {
    // ignore
  }
}
