import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import CryptoJS from 'crypto-js';
import { AwsCredentials, AwsAccount, AccountsStorage } from '../types';

const ACCOUNTS_FILE = 'aws-accounts.json';
const LEGACY_CREDENTIALS_FILE = 'aws-credentials.json';
const ENCRYPTION_KEY = 'aws-ec2-manager-secret-key-2024';

/**
 * ファイルのフルパスを取得
 */
const getFilePath = async (filename: string): Promise<string> => {
  const dataDir = await appDataDir();
  const dirExists = await exists(dataDir);
  if (!dirExists) {
    await mkdir(dataDir, { recursive: true });
  }
  return await join(dataDir, filename);
};

/**
 * UUID を生成する
 */
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ─── マルチアカウント ──────────────────────────────────────────────────────────

/**
 * アカウント一覧を保存する
 */
export async function saveAccounts(storage: AccountsStorage): Promise<void> {
  const json = JSON.stringify(storage);
  const encrypted = CryptoJS.AES.encrypt(json, ENCRYPTION_KEY).toString();
  const path = await getFilePath(ACCOUNTS_FILE);
  await writeTextFile(path, encrypted);
}

/**
 * アカウント一覧を読み込む（旧形式からの自動マイグレーション対応）
 */
export async function loadAccounts(): Promise<AccountsStorage> {
  try {
    const path = await getFilePath(ACCOUNTS_FILE);
    const fileExists = await exists(path);

    if (fileExists) {
      const encrypted = await readTextFile(path);
      if (encrypted && encrypted.trim() !== '') {
        const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
        const json = bytes.toString(CryptoJS.enc.Utf8);
        if (json) {
          return JSON.parse(json) as AccountsStorage;
        }
      }
    }

    // 旧フォーマット（aws-credentials.json）からマイグレーション
    const legacyCreds = await loadLegacyCredentials();
    if (legacyCreds) {
      const account: AwsAccount = {
        id: generateId(),
        name: 'Default',
        accessKeyId: legacyCreds.accessKeyId,
        secretAccessKey: legacyCreds.secretAccessKey,
        region: legacyCreds.region,
      };
      const storage: AccountsStorage = {
        accounts: [account],
        activeAccountId: account.id,
      };
      await saveAccounts(storage);
      return storage;
    }

    return { accounts: [], activeAccountId: null };
  } catch {
    return { accounts: [], activeAccountId: null };
  }
}

/**
 * 旧フォーマット（aws-credentials.json）を読み込む
 */
async function loadLegacyCredentials(): Promise<AwsCredentials | null> {
  try {
    const path = await getFilePath(LEGACY_CREDENTIALS_FILE);
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

/**
 * アカウントを追加する
 */
export async function addAccount(
  storage: AccountsStorage,
  account: Omit<AwsAccount, 'id'>
): Promise<AccountsStorage> {
  const newAccount: AwsAccount = { id: generateId(), ...account };
  const updated: AccountsStorage = {
    accounts: [...storage.accounts, newAccount],
    activeAccountId: storage.activeAccountId ?? newAccount.id,
  };
  await saveAccounts(updated);
  return updated;
}

/**
 * アカウントを更新する
 */
export async function updateAccount(
  storage: AccountsStorage,
  account: AwsAccount
): Promise<AccountsStorage> {
  const updated: AccountsStorage = {
    ...storage,
    accounts: storage.accounts.map((a) => (a.id === account.id ? account : a)),
  };
  await saveAccounts(updated);
  return updated;
}

/**
 * アカウントを削除する
 */
export async function deleteAccount(
  storage: AccountsStorage,
  id: string
): Promise<AccountsStorage> {
  const remaining = storage.accounts.filter((a) => a.id !== id);
  const newActiveId =
    storage.activeAccountId === id
      ? (remaining[0]?.id ?? null)
      : storage.activeAccountId;
  const updated: AccountsStorage = {
    accounts: remaining,
    activeAccountId: newActiveId,
  };
  await saveAccounts(updated);
  return updated;
}

/**
 * アクティブアカウントを切り替える
 */
export async function setActiveAccountId(
  storage: AccountsStorage,
  id: string
): Promise<AccountsStorage> {
  const updated: AccountsStorage = { ...storage, activeAccountId: id };
  await saveAccounts(updated);
  return updated;
}

// ─── 後方互換性 ───────────────────────────────────────────────────────────────

/** @deprecated loadAccounts() を使用してください */
export async function saveCredentials(creds: AwsCredentials): Promise<void> {
  const storage = await loadAccounts();
  if (storage.activeAccountId) {
    const active = storage.accounts.find((a) => a.id === storage.activeAccountId);
    if (active) {
      await updateAccount(storage, { ...active, ...creds });
      return;
    }
  }
  await addAccount(storage, { name: 'Default', ...creds });
}

/** @deprecated loadAccounts() を使用してください */
export async function loadCredentials(): Promise<AwsCredentials | null> {
  const storage = await loadAccounts();
  if (!storage.activeAccountId) return null;
  const active = storage.accounts.find((a) => a.id === storage.activeAccountId);
  if (!active) return null;
  return {
    accessKeyId: active.accessKeyId,
    secretAccessKey: active.secretAccessKey,
    region: active.region,
  };
}

/** @deprecated */
export async function clearCredentials(): Promise<void> {
  // 後方互換性のため残す
}
