import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import { useToast } from '../contexts/ToastContext';
import { EcsCluster, EcsService, CloudWatchLogGroup, CloudWatchLogEvent } from '../types';
import {
  listEcsClusters,
  listEcsServices,
  updateEcsService,
  listEcsLogGroups,
  getEcsLogEvents,
} from '../services/awsService';
import styles from './EcsScreen.module.css';

interface ConfirmDialog {
  cluster: EcsCluster;
  service: EcsService;
  newDesired: number;
  newMin: number;
  newMax: number;
}

// desiredCount の選択肢を生成する
function buildOptions(service: EcsService): number[] {
  const max = service.max_capacity ?? 10;
  const options: number[] = [];
  for (let i = 0; i <= max; i++) {
    options.push(i);
  }
  return options;
}

function ServiceStatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    ACTIVE: styles.statusActive,
    INACTIVE: styles.statusInactive,
    DRAINING: styles.statusDraining,
  };
  const cls = colorMap[status.toUpperCase()] ?? styles.statusUnknown;
  return <span className={`${styles.statusBadge} ${cls}`}>{status}</span>;
}

/** Unix ミリ秒 → "YYYY-MM-DD HH:mm:ss" */
function formatTs(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

export function EcsScreen() {
  const navigate = useNavigate();
  const { credentials } = useApp();
  const { showToast } = useToast();

  const [clusters, setClusters] = useState<EcsCluster[]>([]);
  const [selectedCluster, setSelectedCluster] = useState<EcsCluster | null>(null);
  const [services, setServices] = useState<EcsService[]>([]);
  const [isClustersLoading, setIsClustersLoading] = useState(false);
  const [isServicesLoading, setIsServicesLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmDialog | null>(null);
  // サービスごとの選択中 desiredCount を管理
  const [pendingDesired, setPendingDesired] = useState<Record<string, number>>({});

  // ─── ログ関連ステート ────────────────────────────────────────────────────────
  // ログパネルを開いているサービスARN
  const [logOpenService, setLogOpenService] = useState<EcsService | null>(null);
  const [logGroups, setLogGroups] = useState<CloudWatchLogGroup[]>([]);
  const [selectedLogGroup, setSelectedLogGroup] = useState<string>('');
  const [logEvents, setLogEvents] = useState<CloudWatchLogEvent[]>([]);
  const [isLogGroupsLoading, setIsLogGroupsLoading] = useState(false);
  const [isLogEventsLoading, setIsLogEventsLoading] = useState(false);

  // ─── クラスター一覧を取得 ───────────────────────────────────────────────────
  const fetchClusters = useCallback(async () => {
    if (!credentials) return;
    setIsClustersLoading(true);
    try {
      const data = await listEcsClusters(credentials);
      setClusters(data);
      // 最初のクラスターを自動選択（selectedCluster は setter で確認）
      setSelectedCluster((prev) => (data.length > 0 && !prev ? data[0] : prev));
    } catch (e) {
      console.error('[EcsScreen] fetchClusters error:', e);
      showToast('クラスター取得失敗: ' + String(e), 'error');
    } finally {
      setIsClustersLoading(false);
    }
  }, [credentials, showToast]);

  // ─── サービス一覧を取得 ─────────────────────────────────────────────────────
  const fetchServices = useCallback(async (cluster: EcsCluster) => {
    if (!credentials) return;
    setIsServicesLoading(true);
    setServices([]);
    setPendingDesired({});
    // クラスター切替時はログパネルも閉じる
    setLogOpenService(null);
    setLogGroups([]);
    setSelectedLogGroup('');
    setLogEvents([]);
    try {
      const data = await listEcsServices(credentials, cluster.cluster_arn);
      setServices(data);
      // 初期値として現在の desiredCount をセット
      const initial: Record<string, number> = {};
      data.forEach((s) => {
        initial[s.service_arn] = s.desired_count;
      });
      setPendingDesired(initial);
    } catch (e) {
      console.error('[EcsScreen] fetchServices error:', e);
      showToast('サービス取得失敗: ' + String(e), 'error');
    } finally {
      setIsServicesLoading(false);
    }
  }, [credentials, showToast]);

  useEffect(() => {
    fetchClusters();
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedCluster) {
      fetchServices(selectedCluster);
    }
  }, [selectedCluster]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ─── クラスター切り替え ─────────────────────────────────────────────────────
  const handleClusterChange = (clusterArn: string) => {
    const cluster = clusters.find((c) => c.cluster_arn === clusterArn);
    if (cluster) setSelectedCluster(cluster);
  };

  // ─── 適用ボタン ─────────────────────────────────────────────────────────────
  const handleApply = (service: EcsService) => {
    if (!selectedCluster) return;
    const newDesired = pendingDesired[service.service_arn] ?? service.desired_count;
    const newMin = Math.min(service.min_capacity ?? 0, newDesired);
    const newMax = Math.max(service.max_capacity ?? newDesired, newDesired);
    setConfirm({
      cluster: selectedCluster,
      service,
      newDesired,
      newMin,
      newMax,
    });
  };

  // ─── 確認ダイアログ → 実行 ─────────────────────────────────────────────────
  const executeUpdate = async () => {
    if (!confirm || !credentials) return;
    const { cluster, service, newDesired, newMin, newMax } = confirm;
    setActionLoading(service.service_arn);
    setConfirm(null);
    try {
      await updateEcsService(
        credentials,
        cluster.cluster_arn,
        service.service_name,
        newDesired,
        newMin,
        newMax
      );
      showToast(
        `${service.service_name}: desiredCount を ${newDesired} に更新しました`,
        'success'
      );
      // 少し待ってからリフレッシュ
      setTimeout(() => fetchServices(cluster), 2000);
    } catch (e) {
      console.error('[EcsScreen] executeUpdate error:', e);
      showToast('更新失敗: ' + String(e), 'error');
    } finally {
      setActionLoading(null);
    }
  };

  // ─── ログパネルを開く ───────────────────────────────────────────────────────
  const handleOpenLogs = async (service: EcsService) => {
    if (!credentials) return;

    // 同じサービスをもう一度押したら閉じる
    if (logOpenService?.service_arn === service.service_arn) {
      setLogOpenService(null);
      setLogGroups([]);
      setSelectedLogGroup('');
      setLogEvents([]);
      return;
    }

    setLogOpenService(service);
    setLogGroups([]);
    setSelectedLogGroup('');
    setLogEvents([]);
    setIsLogGroupsLoading(true);

    try {
      const groups = await listEcsLogGroups(credentials, service.service_name);
      setLogGroups(groups);
      if (groups.length > 0) {
        setSelectedLogGroup(groups[0].log_group_name);
      }
    } catch (e) {
      console.error('[EcsScreen] listEcsLogGroups error:', e);
      showToast('ロググループ取得失敗: ' + String(e), 'error');
    } finally {
      setIsLogGroupsLoading(false);
    }
  };

  // ─── ロググループ選択後にイベントを取得 ────────────────────────────────────
  const fetchLogEvents = useCallback(async (logGroupName: string) => {
    if (!credentials || !logGroupName) return;
    setIsLogEventsLoading(true);
    setLogEvents([]);
    try {
      const events = await getEcsLogEvents(credentials, logGroupName, 100);
      setLogEvents(events);
    } catch (e) {
      console.error('[EcsScreen] getEcsLogEvents error:', e);
      showToast('ログ取得失敗: ' + String(e), 'error');
    } finally {
      setIsLogEventsLoading(false);
    }
  }, [credentials, showToast]);

  useEffect(() => {
    if (selectedLogGroup) {
      fetchLogEvents(selectedLogGroup);
    }
  }, [selectedLogGroup]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── クレデンシャル未設定 ──────────────────────────────────────────────────
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
          <h1 className={styles.title}>ECS Services</h1>
        </div>
        <div className={styles.headerRight}>
          <button
            className={styles.iconBtn}
            onClick={() => selectedCluster && fetchServices(selectedCluster)}
            disabled={isServicesLoading || isClustersLoading}
            title="更新"
          >
            {isServicesLoading ? '...' : 'Refresh'}
          </button>
          <button
            className={styles.iconBtn}
            onClick={() => navigate('/instances')}
            title="EC2"
          >
            EC2
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

      {/* クラスター選択 */}
      <div className={styles.clusterSelector}>
        <label className={styles.clusterLabel}>クラスター</label>
        {isClustersLoading ? (
          <div className={styles.clusterLoading}>読み込み中...</div>
        ) : clusters.length === 0 ? (
          <div className={styles.clusterEmpty}>ECSクラスターが見つかりません</div>
        ) : (
          <select
            className={styles.clusterSelect}
            value={selectedCluster?.cluster_arn ?? ''}
            onChange={(e) => handleClusterChange(e.target.value)}
          >
            {clusters.map((c) => (
              <option key={c.cluster_arn} value={c.cluster_arn}>
                {c.cluster_name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* サービス一覧 */}
      {isServicesLoading ? (
        <div className={styles.loadingWrapper}>
          <div className={styles.spinner} />
          <p>サービスを取得中...</p>
        </div>
      ) : !selectedCluster ? null : services.length === 0 ? (
        <div className={styles.empty}>
          <p>サービスが見つかりません</p>
        </div>
      ) : (
        <div className={styles.list}>
          {services.map((service) => {
            const isUpdating = actionLoading === service.service_arn;
            const options = buildOptions(service);
            const currentPending = pendingDesired[service.service_arn] ?? service.desired_count;
            const hasChange = currentPending !== service.desired_count;
            const isLogOpen = logOpenService?.service_arn === service.service_arn;

            return (
              <div key={service.service_arn} className={styles.card}>
                <div className={styles.cardTop}>
                  <div className={styles.serviceName}>{service.service_name}</div>
                  <ServiceStatusBadge status={service.status} />
                </div>

                {/* タスク数サマリー */}
                <div className={styles.taskSummary}>
                  <div className={styles.taskItem}>
                    <span className={styles.taskLabel}>Desired</span>
                    <span className={styles.taskValue}>{service.desired_count}</span>
                  </div>
                  <div className={styles.taskDivider} />
                  <div className={styles.taskItem}>
                    <span className={styles.taskLabel}>Running</span>
                    <span className={`${styles.taskValue} ${service.running_count > 0 ? styles.taskRunning : ''}`}>
                      {service.running_count}
                    </span>
                  </div>
                  <div className={styles.taskDivider} />
                  <div className={styles.taskItem}>
                    <span className={styles.taskLabel}>Pending</span>
                    <span className={styles.taskValue}>{service.pending_count}</span>
                  </div>
                </div>

                {/* Auto Scaling 情報 */}
                {(service.min_capacity !== null || service.max_capacity !== null) && (
                  <div className={styles.scalingInfo}>
                    <span className={styles.scalingLabel}>Auto Scaling:</span>
                    <span className={styles.scalingValue}>
                      min={service.min_capacity ?? '-'} / max={service.max_capacity ?? '-'}
                    </span>
                  </div>
                )}

                {/* desiredCount 変更コントロール */}
                <div className={styles.cardActions}>
                  <div className={styles.desiredControl}>
                    <span className={styles.desiredLabel}>Desired Count</span>
                    <select
                      className={`${styles.desiredSelect} ${hasChange ? styles.desiredSelectChanged : ''}`}
                      value={currentPending}
                      onChange={(e) =>
                        setPendingDesired((prev) => ({
                          ...prev,
                          [service.service_arn]: Number(e.target.value),
                        }))
                      }
                      disabled={isUpdating}
                    >
                      {options.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    className={`${styles.applyBtn} ${hasChange ? styles.applyBtnChanged : ''}`}
                    onClick={() => handleApply(service)}
                    disabled={isUpdating || !hasChange}
                  >
                    {isUpdating ? '更新中...' : '適用'}
                  </button>
                  {/* ログボタン */}
                  <button
                    className={`${styles.logBtn} ${isLogOpen ? styles.logBtnActive : ''}`}
                    onClick={() => handleOpenLogs(service)}
                    title="CloudWatch Logs を表示"
                  >
                    {isLogOpen ? 'Logs ▲' : 'Logs ▼'}
                  </button>
                </div>

                {/* ─── ログパネル ─────────────────────────────────────── */}
                {isLogOpen && (
                  <div className={styles.logPanel}>
                    {/* ロググループ選択 */}
                    <div className={styles.logGroupRow}>
                      <span className={styles.logGroupLabel}>Log Group</span>
                      {isLogGroupsLoading ? (
                        <span className={styles.logGroupLoading}>取得中...</span>
                      ) : logGroups.length === 0 ? (
                        <span className={styles.logGroupEmpty}>
                          ロググループが見つかりません（/ecs/{service.service_name}）
                        </span>
                      ) : (
                        <>
                          <select
                            className={styles.logGroupSelect}
                            value={selectedLogGroup}
                            onChange={(e) => setSelectedLogGroup(e.target.value)}
                          >
                            {logGroups.map((g) => (
                              <option key={g.log_group_name} value={g.log_group_name}>
                                {g.log_group_name}
                                {g.retention_in_days ? ` (${g.retention_in_days}d)` : ''}
                              </option>
                            ))}
                          </select>
                          <button
                            className={styles.logRefreshBtn}
                            onClick={() => fetchLogEvents(selectedLogGroup)}
                            disabled={isLogEventsLoading}
                            title="ログを更新"
                          >
                            ↺
                          </button>
                        </>
                      )}
                    </div>

                    {/* ログイベント表示 */}
                    {logGroups.length > 0 && (
                      <div className={styles.logEventArea}>
                        {isLogEventsLoading ? (
                          <div className={styles.logLoading}>
                            <div className={styles.logSpinner} />
                            <span>ログを取得中...</span>
                          </div>
                        ) : logEvents.length === 0 ? (
                          <div className={styles.logEmpty}>ログイベントがありません</div>
                        ) : (
                          logEvents.map((ev, idx) => (
                            <div key={idx} className={styles.logEventRow}>
                              <span className={styles.logTs}>{formatTs(ev.timestamp)}</span>
                              <span className={styles.logStream} title={ev.log_stream_name}>
                                {ev.log_stream_name.length > 30
                                  ? '…' + ev.log_stream_name.slice(-28)
                                  : ev.log_stream_name}
                              </span>
                              <span className={styles.logMsg}>{ev.message}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 確認ダイアログ */}
      {confirm && (
        <div className={styles.overlay}>
          <div className={styles.dialog}>
            <h2 className={styles.dialogTitle}>ECSサービスの更新</h2>
            <p className={styles.dialogMsg}>
              <strong>{confirm.service.service_name}</strong> の設定を変更しますか？
            </p>
            <div className={styles.dialogDetail}>
              <div className={styles.dialogDetailRow}>
                <span className={styles.dialogDetailLabel}>Desired Count</span>
                <span className={styles.dialogDetailValue}>
                  {confirm.service.desired_count} → <strong className={styles.dialogNewValue}>{confirm.newDesired}</strong>
                </span>
              </div>
              {confirm.service.min_capacity !== null && (
                <div className={styles.dialogDetailRow}>
                  <span className={styles.dialogDetailLabel}>Min Capacity</span>
                  <span className={styles.dialogDetailValue}>{confirm.newMin}</span>
                </div>
              )}
              {confirm.service.max_capacity !== null && (
                <div className={styles.dialogDetailRow}>
                  <span className={styles.dialogDetailLabel}>Max Capacity</span>
                  <span className={styles.dialogDetailValue}>{confirm.newMax}</span>
                </div>
              )}
            </div>
            <div className={styles.dialogActions}>
              <button
                className={styles.dialogCancelBtn}
                onClick={() => setConfirm(null)}
              >
                キャンセル
              </button>
              <button
                className={`${styles.dialogOkBtn} ${confirm.newDesired === 0 ? styles.dialogStopBtn : ''}`}
                onClick={executeUpdate}
              >
                {confirm.newDesired === 0 ? '停止する' : '更新する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
