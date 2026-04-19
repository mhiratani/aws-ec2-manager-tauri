import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { AwsCredentials, AwsAccount, AccountsStorage } from '../types';
import {
  loadAccounts,
  addAccount,
  updateAccount,
  deleteAccount,
  setActiveAccountId,
} from '../services/storage';

interface AppContextType {
  // マルチアカウント
  accounts: AwsAccount[];
  activeAccount: AwsAccount | null;
  accountsStorage: AccountsStorage;
  switchAccount: (id: string) => Promise<void>;
  addNewAccount: (account: Omit<AwsAccount, 'id'>) => Promise<void>;
  updateExistingAccount: (account: AwsAccount) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
  // 後方互換性（EC2/ECS画面で使用）
  credentials: AwsCredentials | null;
  setCredentials: (creds: AwsCredentials | null) => Promise<void>;
  isLoading: boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [storage, setStorage] = useState<AccountsStorage>({ accounts: [], activeAccountId: null });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const loaded = await loadAccounts();
        setStorage(loaded);
      } catch {
        // ignore
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // アクティブアカウントを取得
  const activeAccount: AwsAccount | null =
    storage.accounts.find((a) => a.id === storage.activeAccountId) ?? null;

  // 後方互換性: AwsCredentials 形式で返す
  const credentials: AwsCredentials | null = activeAccount
    ? {
        accessKeyId: activeAccount.accessKeyId,
        secretAccessKey: activeAccount.secretAccessKey,
        region: activeAccount.region,
      }
    : null;

  // アカウント切り替え
  const switchAccount = async (id: string) => {
    const updated = await setActiveAccountId(storage, id);
    setStorage(updated);
  };

  // アカウント追加
  const addNewAccount = async (account: Omit<AwsAccount, 'id'>) => {
    const updated = await addAccount(storage, account);
    setStorage(updated);
  };

  // アカウント更新
  const updateExistingAccount = async (account: AwsAccount) => {
    const updated = await updateAccount(storage, account);
    setStorage(updated);
  };

  // アカウント削除
  const removeAccount = async (id: string) => {
    const updated = await deleteAccount(storage, id);
    setStorage(updated);
  };

  // 後方互換性: setCredentials（アクティブアカウントを上書き or 新規追加）
  const setCredentials = async (creds: AwsCredentials | null) => {
    if (!creds) return;
    if (activeAccount) {
      await updateExistingAccount({ ...activeAccount, ...creds });
    } else {
      await addNewAccount({ name: 'Default', ...creds });
    }
  };

  return (
    <AppContext.Provider
      value={{
        accounts: storage.accounts,
        activeAccount,
        accountsStorage: storage,
        switchAccount,
        addNewAccount,
        updateExistingAccount,
        removeAccount,
        credentials,
        setCredentials,
        isLoading,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
