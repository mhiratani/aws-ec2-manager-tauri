import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { useApp } from '../contexts/AppContext';
import { useToast } from '../contexts/ToastContext';
import { MonthlyCostSummary, CostEntry } from '../types';
import { getMonthlyCost } from '../services/awsService';
import styles from './CostScreen.module.css';

const BAR_COLORS = [
  '#ff9900', '#3b82f6', '#22c55e', '#f97316', '#a855f7',
  '#ec4899', '#14b8a6', '#eab308', '#ef4444', '#64748b',
];

interface ChartEntry {
  name: string;
  amount: number;
  color: string;
}

function formatAmount(amount: string, unit: string): string {
  const val = parseFloat(amount);
  return `${val.toFixed(2)} ${unit}`;
}

function shortName(service: string): string {
  // サービス名を短縮表示
  return service
    .replace('Amazon ', '')
    .replace('AWS ', '')
    .replace('Elastic Compute Cloud', 'EC2')
    .replace('Simple Storage Service', 'S3')
    .replace('Relational Database Service', 'RDS')
    .replace('CloudFront', 'CloudFront')
    .replace('Lambda', 'Lambda');
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; payload: ChartEntry }>;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0];
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipLabel}>{d.payload.name}</div>
      <div className={styles.tooltipValue}>${d.value.toFixed(4)}</div>
    </div>
  );
}

export function CostScreen() {
  const navigate = useNavigate();
  const { credentials } = useApp();
  const { showToast } = useToast();

  const [summary, setSummary] = useState<MonthlyCostSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchCost = useCallback(async () => {
    if (!credentials) return;
    setIsLoading(true);
    try {
      const data = await getMonthlyCost(credentials);
      setSummary(data);
    } catch (e) {
      console.error('[CostScreen] fetchCost error:', e);
      showToast('コスト取得失敗: ' + String(e), 'error');
    } finally {
      setIsLoading(false);
    }
  }, [credentials, showToast]);

  useEffect(() => {
    fetchCost();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!credentials) {
    return (
      <div className={styles.empty}>
        <p>クレデンシャルが設定されていません</p>
        <button className={styles.backBtn} onClick={() => navigate('/settings')}>
          設定画面へ
        </button>
      </div>
    );
  }

  // グラフ用データ（上位15件、0円以上のみ）
  const chartData: ChartEntry[] = (summary?.by_service ?? [])
    .filter((e: CostEntry) => parseFloat(e.amount) > 0)
    .slice(0, 15)
    .map((e: CostEntry, i: number) => ({
      name: shortName(e.service),
      amount: parseFloat(e.amount),
      color: BAR_COLORS[i % BAR_COLORS.length],
    }));

  return (
    <div className={styles.container}>
      {/* ヘッダー */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.backBtn2} onClick={() => navigate('/instances')}>
            &lt; Back
          </button>
          <h1 className={styles.title}>Cost Explorer</h1>
        </div>
        <button
          className={styles.iconBtn}
          onClick={fetchCost}
          disabled={isLoading}
        >
          {isLoading ? '...' : 'Refresh'}
        </button>
      </div>

      {isLoading && !summary ? (
        <div className={styles.loadingWrapper}>
          <div className={styles.spinner} />
          <p>読み込み中...</p>
        </div>
      ) : summary ? (
        <div className={styles.content}>
          {/* 合計コスト */}
          <div className={styles.totalCard}>
            <div className={styles.totalLabel}>当月合計コスト</div>
            <div className={styles.totalAmount}>
              ${parseFloat(summary.total_amount).toFixed(2)}
              <span className={styles.totalUnit}>{summary.unit}</span>
            </div>
            <div className={styles.totalPeriod}>
              {summary.period_start} ~ {summary.period_end}
            </div>
          </div>

          {/* 棒グラフ */}
          {chartData.length > 0 && (
            <div className={styles.chartCard}>
              <div className={styles.sectionTitle}>サービス別コスト (USD)</div>
              <div className={styles.chartWrapper}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={chartData}
                    margin={{ top: 8, right: 8, left: -10, bottom: 60 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e2d3d" />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: '#64748b', fontSize: 10 }}
                      angle={-40}
                      textAnchor="end"
                      interval={0}
                    />
                    <YAxis
                      tick={{ fill: '#64748b', fontSize: 10 }}
                      tickFormatter={(v) => `$${v}`}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                      {chartData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* サービス別リスト */}
          <div className={styles.listCard}>
            <div className={styles.sectionTitle}>サービス別内訳</div>
            <div className={styles.serviceList}>
              {summary.by_service
                .filter((e: CostEntry) => parseFloat(e.amount) > 0)
                .map((entry: CostEntry, i: number) => {
                  const pct =
                    parseFloat(summary.total_amount) > 0
                      ? (parseFloat(entry.amount) / parseFloat(summary.total_amount)) * 100
                      : 0;
                  return (
                    <div key={i} className={styles.serviceRow}>
                      <div className={styles.serviceInfo}>
                        <div
                          className={styles.serviceDot}
                          style={{ background: BAR_COLORS[i % BAR_COLORS.length] }}
                        />
                        <span className={styles.serviceName}>{entry.service}</span>
                      </div>
                      <div className={styles.serviceRight}>
                        <div className={styles.serviceBar}>
                          <div
                            className={styles.serviceBarFill}
                            style={{
                              width: `${pct}%`,
                              background: BAR_COLORS[i % BAR_COLORS.length],
                            }}
                          />
                        </div>
                        <span className={styles.serviceAmount}>
                          {formatAmount(entry.amount, entry.unit)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              {summary.by_service.filter((e: CostEntry) => parseFloat(e.amount) > 0).length === 0 && (
                <p className={styles.noData}>コストデータがありません</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.empty}>
          <p>データがありません</p>
          <button className={styles.backBtn} onClick={fetchCost}>
            再読み込み
          </button>
        </div>
      )}
    </div>
  );
}
