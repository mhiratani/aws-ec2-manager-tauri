import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import { useToast } from '../contexts/ToastContext';
import { AwsAccount, AWS_REGIONS } from '../types';
import styles from './SettingsScreen.module.css';

type Mode = 'list' | 'add' | 'edit';

interface AccountFormState {
  name: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  showSecret: boolean;
}

const defaultForm = (): AccountFormState => ({
  name: '',
  accessKeyId: '',
  secretAccessKey: '',
  region: 'ap-northeast-1',
  showSecret: false,
});

export function SettingsScreen() {
  const navigate = useNavigate();
  const { accounts, activeAccount, switchAccount, addNewAccount, updateExistingAccount, removeAccount } = useApp();
  const { showToast } = useToast();

  const [mode, setMode] = useState<Mode>('list');
  const [editTarget, setEditTarget] = useState<AwsAccount | null>(null);
  const [form, setForm] = useState<AccountFormState>(defaultForm());
  const [isSaving, setIsSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<AwsAccount | null>(null);

  // ─── アカウント追加モードへ ────────────────────────────────────────────────
  const handleAddMode = () => {
    setForm(defaultForm());
    setEditTarget(null);
    setMode('add');
  };

  // ─── アカウント編集モードへ ───────────────────────────────────────────────
  const handleEditMode = (account: AwsAccount) => {
    setForm({
      name: account.name,
      accessKeyId: account.accessKeyId,
      secretAccessKey: account.secretAccessKey,
      region: account.region,
      showSecret: false,
    });
    setEditTarget(account);
    setMode('edit');
  };

  // ─── 保存処理 ──────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.name.trim()) {
      showToast('アカウント名を入力してください', 'error');
      return;
    }
    if (!form.accessKeyId.trim()) {
      showToast('Access Key IDを入力してください', 'error');
      return;
    }
    if (!form.secretAccessKey.trim()) {
      showToast('Secret Access Keyを入力してください', 'error');
      return;
    }
    setIsSaving(true);
    try {
      if (mode === 'add') {
        await addNewAccount({
          name: form.name.trim(),
          accessKeyId: form.accessKeyId.trim(),
          secretAccessKey: form.secretAccessKey.trim(),
          region: form.region,
        });
        showToast(`"${form.name}" を追加しました`, 'success');
      } else if (mode === 'edit' && editTarget) {
        await updateExistingAccount({
          ...editTarget,
          name: form.name.trim(),
          accessKeyId: form.accessKeyId.trim(),
          secretAccessKey: form.secretAccessKey.trim(),
          region: form.region,
        });
        showToast(`"${form.name}" を更新しました`, 'success');
      }
      setMode('list');
    } catch (e) {
      showToast('保存に失敗しました: ' + String(e), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // ─── アカウント削除 ────────────────────────────────────────────────────────
  const handleDeleteConfirm = async () => {
    if (!deleteConfirm) return;
    try {
      await removeAccount(deleteConfirm.id);
      showToast(`"${deleteConfirm.name}" を削除しました`, 'success');
    } catch (e) {
      showToast('削除に失敗しました: ' + String(e), 'error');
    } finally {
      setDeleteConfirm(null);
    }
  };

  // ─── アカウント切り替え ────────────────────────────────────────────────────
  const handleSwitch = async (account: AwsAccount) => {
    if (account.id === activeAccount?.id) return;
    try {
      await switchAccount(account.id);
      showToast(`"${account.name}" に切り替えました`, 'success');
    } catch (e) {
      showToast('切り替えに失敗しました: ' + String(e), 'error');
    }
  };

  // ─── フォーム画面 ──────────────────────────────────────────────────────────
  if (mode === 'add' || mode === 'edit') {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>
            {mode === 'add' ? 'アカウントを追加' : 'アカウントを編集'}
          </h1>
          <p className={styles.subtitle}>AWSクレデンシャルを入力してください</p>
        </div>

        <div className={styles.form}>
          <div className={styles.formGroup}>
            <label className={styles.label}>アカウント名</label>
            <input
              className={styles.input}
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="例: 開発環境、本番環境"
              autoComplete="off"
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>AWS Access Key ID</label>
            <input
              className={styles.input}
              type="text"
              value={form.accessKeyId}
              onChange={(e) => setForm((f) => ({ ...f, accessKeyId: e.target.value }))}
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
                type={form.showSecret ? 'text' : 'password'}
                value={form.secretAccessKey}
                onChange={(e) => setForm((f) => ({ ...f, secretAccessKey: e.target.value }))}
                placeholder="••••••••••••••••••••••••••••••••••••••••"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                className={styles.toggleBtn}
                onClick={() => setForm((f) => ({ ...f, showSecret: !f.showSecret }))}
                type="button"
              >
                {form.showSecret ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>AWS Region</label>
            <select
              className={styles.select}
              value={form.region}
              onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
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
            {isSaving ? '保存中...' : mode === 'add' ? '追加する' : '更新する'}
          </button>

          <button
            className={styles.cancelBtn}
            onClick={() => setMode('list')}
            type="button"
          >
            キャンセル
          </button>
        </div>
      </div>
    );
  }

  // ─── アカウント一覧画面 ────────────────────────────────────────────────────
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerRow}>
          <h1 className={styles.title}>AWS Settings</h1>
          {accounts.length > 0 && (
            <button
              className={styles.iconBtn}
              onClick={() => navigate(activeAccount ? '/instances' : '/')}
            >
              ✕
            </button>
          )}
        </div>
        <p className={styles.subtitle}>AWSアカウントを管理します</p>
      </div>

      {accounts.length === 0 ? (
        <div className={styles.emptyAccounts}>
          <p className={styles.emptyText}>アカウントが登録されていません</p>
          <button className={styles.addBtn} onClick={handleAddMode}>
            + アカウントを追加
          </button>
        </div>
      ) : (
        <>
          <div className={styles.accountList}>
            {accounts.map((account) => {
              const isActive = account.id === activeAccount?.id;
              return (
                <div
                  key={account.id}
                  className={`${styles.accountCard} ${isActive ? styles.accountCardActive : ''}`}
                  onClick={() => handleSwitch(account)}
                >
                  <div className={styles.accountCardLeft}>
                    <div className={styles.accountActiveIcon}>
                      {isActive ? '✓' : ''}
                    </div>
                    <div className={styles.accountInfo}>
                      <div className={styles.accountName}>{account.name}</div>
                      <div className={styles.accountMeta}>
                        {account.region} · {account.accessKeyId.slice(0, 8)}···
                      </div>
                    </div>
                  </div>
                  <div
                    className={styles.accountCardActions}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      className={styles.editBtn}
                      onClick={() => handleEditMode(account)}
                    >
                      編集
                    </button>
                    <button
                      className={styles.deleteBtn}
                      onClick={() => setDeleteConfirm(account)}
                    >
                      削除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <button className={styles.addBtn} onClick={handleAddMode}>
            + アカウントを追加
          </button>
        </>
      )}

      <div className={styles.note}>
        <p>クレデンシャルはデバイス内に暗号化して保存されます。</p>
        <p>
          必要な権限:{' '}
          <code>ec2:Describe*</code>, <code>ec2:StartInstances</code>,{' '}
          <code>ec2:StopInstances</code>, <code>ecs:*</code>,{' '}
          <code>application-autoscaling:*</code>, <code>ce:GetCostAndUsage</code>
        </p>
      </div>

      {/* 削除確認ダイアログ */}
      {deleteConfirm && (
        <div className={styles.overlay}>
          <div className={styles.dialog}>
            <h2 className={styles.dialogTitle}>アカウントの削除</h2>
            <p className={styles.dialogMsg}>
              <strong>{deleteConfirm.name}</strong> を削除しますか？
            </p>
            <div className={styles.dialogActions}>
              <button
                className={styles.dialogCancelBtn}
                onClick={() => setDeleteConfirm(null)}
              >
                キャンセル
              </button>
              <button
                className={`${styles.dialogOkBtn} ${styles.dialogDeleteBtn}`}
                onClick={handleDeleteConfirm}
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
