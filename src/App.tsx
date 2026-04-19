import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './contexts/AppContext';
import { ToastProvider } from './contexts/ToastContext';
import { SettingsScreen } from './screens/SettingsScreen';
import { InstanceListScreen } from './screens/InstanceListScreen';
import { CostScreen } from './screens/CostScreen';
import { EcsScreen } from './screens/EcsScreen';
import './App.css';

// AppProvider の内側で使用するリダイレクトコンポーネント
function RootRedirect() {
  const { credentials, isLoading } = useApp();
  if (isLoading) {
    return (
      <div className="splash">
        <div className="splashSpinner" />
      </div>
    );
  }
  return <Navigate to={credentials ? '/instances' : '/settings'} replace />;
}

function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="/instances" element={<InstanceListScreen />} />
        <Route path="/cost" element={<CostScreen />} />
        <Route path="/ecs" element={<EcsScreen />} />
      </Routes>
    </BrowserRouter>
  );
}

function App() {
  return (
    <ToastProvider>
      <AppProvider>
        <AppRoutes />
      </AppProvider>
    </ToastProvider>
  );
}

export default App;
