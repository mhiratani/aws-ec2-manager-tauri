import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import { useToast } from '../contexts/ToastContext';
import { AWS_REGIONS } from '../types';
import styles from './SettingsScreen.module.css';

export function SettingsScreen() {
  const navigate = useNavigate();
  const { credentials, setCredentials } = useApp();
  const { showToast } = useToast();

  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [region, setRegion] = useState('ap-northeast-1');
  const [showSecret, setShowSecret] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (credentials) {
      setAccessKeyId(credentials.accessKeyId);
      setSecretAccessKey(credentials.secretAccessKey);
      setRegion(credentials.region);
    }
  }, [credentials]);

  const handleSave = async () => {
    if (!accessKeyId.trim()) {
      showToast('Access Key IDを入力してください', 'error');
      return;
    }
    if (!secretAccessKey.trim()) {
      showToast('Secret Access Keyを入力してください', 'error');
      return;
    }
    setIsSaving(true);
    try {
      await setCredentials({
        accessKeyId: accessKeyId.trim(),
        secretAccessKey: secretAccessKey.trim(),
        region,
      });
      showToast('クレデンシャルを保存しました', 'success');
      navigate('/instances');
    } catch (e) {
      showToast('保存に失敗しました: ' + String(e), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>AWS Settings</h1>
        <p className={styles.subtitle}>AWSクレデンシャルを入力してください</p>
      </div>

      <div className={styles.form}>
        <div className={styles.formGroup}>
          <label className={styles.label}>AWS Access Key ID</label>
          <input
            className={styles.input}
            type="text"
            value={accessKeyId}
            onChange={(e) => setAccessKeyId(e.target.value)}
            placeholder="AKIAxxxxxxxxxxxxxxxxxxx"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className={styles.formGroup}>
          <label className={styles.label}>AWS Secret Access Key</label>
          <div className={styles.secretWrapper}>
            <input
              className={styles.input}
              type={showSecret ? 'text' : 'password'}
              value={secretAccessKey}
              onChange={(e) => setSecretAccessKey(e.target.value)}
              placeholder="••••••••••••••••••••••••••••••••••••••••"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              className={styles.toggleBtn}
              onClick={() => setShowSecret((v) => !v)}
              type="button"
            >
              {showSecret ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        <div className={styles.formGroup}>
          <label className={styles.label}>AWS Region</label>
          <select
            className={styles.select}
            value={region}
            onChange={(e) => setRegion(e.target.value)}
          >
            {AWS_REGIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label} ({r.value})
              </option>
            ))}
          </select>
        </div>

        <button
          className={styles.saveBtn}
          onClick={handleSave}
          disabled={isSaving}
        >
          {isSaving ? '保存中...' : '保存して接続'}
        </button>

        {credentials && (
          <button
            className={styles.cancelBtn}
            onClick={() => navigate('/instances')}
            type="button"
          >
            キャンセル
          </button>
        )}
      </div>

      <div className={styles.note}>
        <p>クレデンシャルはデバイス内に暗号化して保存されます。</p>
        <p>必要な権限: <code>ec2:Describe*</code>, <code>ec2:StartInstances</code>, <code>ec2:StopInstances</code>, <code>ce:GetCostAndUsage</code></p>
      </div>
    </div>
  );
}
