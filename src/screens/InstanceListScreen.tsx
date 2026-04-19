import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import { useToast } from '../contexts/ToastContext';
import { Ec2Instance } from '../types';
import { listInstances, startInstance, stopInstance } from '../services/awsService';
import styles from './InstanceListScreen.module.css';

function StateBadge({ state }: { state: string }) {
  const colorMap: Record<string, string> = {
    running: styles.stateRunning,
    stopped: styles.stateStopped,
    pending: styles.statePending,
    stopping: styles.stateStopping,
    'shutting-down': styles.stateStopping,
    terminated: styles.stateTerminated,
  };
  const cls = colorMap[state] ?? styles.stateUnknown;
  return <span className={`${styles.stateBadge} ${cls}`}>{state}</span>;
}

interface ConfirmDialog {
  instanceId: string;
  instanceName: string;
  action: 'start' | 'stop';
}

export function InstanceListScreen() {
  const navigate = useNavigate();
  const { credentials } = useApp();
  const { showToast } = useToast();

  const [instances, setInstances] = useState<Ec2Instance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmDialog | null>(null);

  const fetchInstances = useCallback(async () => {
    if (!credentials) return;
    setIsLoading(true);
    try {
      const data = await listInstances(credentials);
      setInstances(data);
    } catch (e) {
      showToast('インスタンス取得失敗: ' + String(e), 'error');
    } finally {
      setIsLoading(false);
    }
  }, [credentials, showToast]);

  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  const handleAction = (inst: Ec2Instance, action: 'start' | 'stop') => {
    setConfirm({
      instanceId: inst.instance_id,
      instanceName: inst.name || inst.instance_id,
      action,
    });
  };

  const executeAction = async () => {
    if (!confirm || !credentials) return;
    setActionLoading(confirm.instanceId);
    setConfirm(null);
    try {
      if (confirm.action === 'start') {
        await startInstance(credentials, confirm.instanceId);
        showToast(`${confirm.instanceName} の起動を開始しました`, 'success');
      } else {
        await stopInstance(credentials, confirm.instanceId);
        showToast(`${confirm.instanceName} の停止を開始しました`, 'success');
      }
      // 少し待ってからリフレッシュ
      setTimeout(() => fetchInstances(), 2000);
    } catch (e) {
      showToast('操作失敗: ' + String(e), 'error');
    } finally {
      setActionLoading(null);
    }
  };

  if (!credentials) {
    return (
      <div className={styles.empty}>
        <p>クレデンシャルが設定されていません</p>
        <button className={styles.settingsBtn} onClick={() => navigate('/settings')}>
          設定画面へ
        </button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* ヘッダー */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>EC2 Instances</h1>
          <span className={styles.region}>{credentials.region}</span>
        </div>
        <div className={styles.headerRight}>
          <button
            className={styles.iconBtn}
            onClick={fetchInstances}
            disabled={isLoading}
            title="更新"
          >
            {isLoading ? '...' : 'Refresh'}
          </button>
          <button
            className={styles.iconBtn}
            onClick={() => navigate('/ecs')}
            title="ECS"
          >
            ECS
          </button>
          <button
            className={styles.iconBtn}
            onClick={() => navigate('/cost')}
            title="コスト"
          >
            Cost
          </button>
          <button
            className={styles.iconBtn}
            onClick={() => navigate('/settings')}
            title="設定"
          >
            Settings
          </button>
        </div>
      </div>

      {/* インスタンスリスト */}
      {isLoading && instances.length === 0 ? (
        <div className={styles.loadingWrapper}>
          <div className={styles.spinner} />
          <p>読み込み中...</p>
        </div>
      ) : instances.length === 0 ? (
        <div className={styles.empty}>
          <p>インスタンスが見つかりません</p>
          <button className={styles.settingsBtn} onClick={fetchInstances}>
            再読み込み
          </button>
        </div>
      ) : (
        <div className={styles.list}>
          {instances.map((inst) => {
            const isActioning = actionLoading === inst.instance_id;
            const canStart = inst.state === 'stopped';
            const canStop = inst.state === 'running';

            return (
              <div key={inst.instance_id} className={styles.card}>
                <div className={styles.cardTop}>
                  <div className={styles.instanceName}>
                    {inst.name || '(no name)'}
                  </div>
                  <StateBadge state={inst.state} />
                </div>
                <div className={styles.cardMeta}>
                  <span className={styles.metaItem}>
                    <span className={styles.metaLabel}>ID</span>
                    <span className={styles.metaValue}>{inst.instance_id}</span>
                  </span>
                  <span className={styles.metaItem}>
                    <span className={styles.metaLabel}>Type</span>
                    <span className={styles.metaValue}>{inst.instance_type}</span>
                  </span>
                  <span className={styles.metaItem}>
                    <span className={styles.metaLabel}>AZ</span>
                    <span className={styles.metaValue}>{inst.availability_zone}</span>
                  </span>
                  {inst.public_ip && (
                    <span className={styles.metaItem}>
                      <span className={styles.metaLabel}>Public IP</span>
                      <span className={styles.metaValue}>{inst.public_ip}</span>
                    </span>
                  )}
                  {inst.private_ip && (
                    <span className={styles.metaItem}>
                      <span className={styles.metaLabel}>Private IP</span>
                      <span className={styles.metaValue}>{inst.private_ip}</span>
                    </span>
                  )}
                </div>
                <div className={styles.cardActions}>
                  <button
                    className={`${styles.actionBtn} ${styles.startBtn}`}
                    onClick={() => handleAction(inst, 'start')}
                    disabled={!canStart || isActioning}
                  >
                    {isActioning && canStart ? '処理中...' : 'Start'}
                  </button>
                  <button
                    className={`${styles.actionBtn} ${styles.stopBtn}`}
                    onClick={() => handleAction(inst, 'stop')}
                    disabled={!canStop || isActioning}
                  >
                    {isActioning && canStop ? '処理中...' : 'Stop'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 確認ダイアログ */}
      {confirm && (
        <div className={styles.overlay}>
          <div className={styles.dialog}>
            <h2 className={styles.dialogTitle}>
              {confirm.action === 'start' ? 'インスタンスの起動' : 'インスタンスの停止'}
            </h2>
            <p className={styles.dialogMsg}>
              <strong>{confirm.instanceName}</strong> を
              {confirm.action === 'start' ? '起動' : '停止'}しますか？
            </p>
            <div className={styles.dialogActions}>
              <button
                className={styles.dialogCancelBtn}
                onClick={() => setConfirm(null)}
              >
                キャンセル
              </button>
              <button
                className={`${styles.dialogOkBtn} ${confirm.action === 'stop' ? styles.dialogStopBtn : ''}`}
                onClick={executeAction}
              >
                {confirm.action === 'start' ? '起動する' : '停止する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
