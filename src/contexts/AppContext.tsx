import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { AwsCredentials } from '../types';
import { loadCredentials, saveCredentials } from '../services/storage';

interface AppContextType {
  credentials: AwsCredentials | null;
  setCredentials: (creds: AwsCredentials | null) => Promise<void>;
  isLoading: boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [credentials, setCredsState] = useState<AwsCredentials | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const creds = await loadCredentials();
        if (creds) setCredsState(creds);
      } catch {
        // ignore
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const setCredentials = async (creds: AwsCredentials | null) => {
    setCredsState(creds);
    if (creds) {
      await saveCredentials(creds);
    }
  };

  return (
    <AppContext.Provider value={{ credentials, setCredentials, isLoading }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
