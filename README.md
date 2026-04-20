# AWS EC2 Manager

Tauri 2 + React + TypeScript で構築したAWS EC2管理アプリです。Android APK としてビルドできます。

## 機能

- **AWS設定**: Access Key ID / Secret Access Key / Region を暗号化してデバイスに保存
- **EC2インスタンス一覧**: 指定リージョンのEC2インスタンス状態を一覧表示
- **インスタンス操作**: Start / Stop（確認ダイアログあり）
- **コスト可視化**: 当月のAWS全サービスコストをグラフ＋リストで表示（Cost Explorer API）

## 必要なAWS権限

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:StartInstances",
        "ec2:StopInstances"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ce:GetCostAndUsage"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecs:ListClusters",
        "ecs:DescribeClusters",
        "ecs:ListServices",
        "ecs:DescribeServices",
        "ecs:UpdateService",
        "application-autoscaling:DescribeScalableTargets",
        "application-autoscaling:RegisterScalableTarget"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
        "logs:GetLogEvents"
      ],
      "Resource": "*"
    }
  ]
}
```

## 開発環境のセットアップ

```bash
# 依存パッケージのインストール
npm install

# デスクトップ版の開発サーバー起動
npm run tauri dev

# デスクトップ版ビルド
npm run tauri build
```

## Android APKビルド

```bash
# Android環境の初期化（初回のみ）
npm run tauri android init

# APKビルド & 署名（build-android.sh を使用）
chmod +x build-android.sh
./build-android.sh
```

### Android ビルド要件

| ツール | バージョン |
|--------|-----------|
| Java | 17 |
| Android SDK | 最新 |
| NDK | 27.2.12479018 |
| Build Tools | 35.0.0 |
| Rust targets | aarch64-linux-android, armv7-linux-androideabi, i686-linux-android, x86_64-linux-android |

### Rustターゲットの追加

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

## プロジェクト構成

```
aws-ec2-manager-tauri/
├── src/
│   ├── App.tsx                      # ルーティング設定
│   ├── contexts/
│   │   ├── AppContext.tsx            # クレデンシャル状態管理
│   │   └── ToastContext.tsx          # トースト通知
│   ├── screens/
│   │   ├── SettingsScreen.tsx        # AWS設定画面
│   │   ├── InstanceListScreen.tsx    # EC2インスタンス一覧・操作
│   │   └── CostScreen.tsx           # コスト可視化
│   ├── services/
│   │   ├── awsService.ts            # Tauri invoke ラッパー
│   │   └── storage.ts               # クレデンシャル暗号化保存
│   └── types/
│       └── index.ts                 # 型定義・定数
├── src-tauri/
│   ├── src/
│   │   └── lib.rs                   # AWS SDK Tauriコマンド
│   ├── Cargo.toml                   # Rust依存関係
│   └── tauri.conf.json              # Tauri設定
└── build-android.sh                 # APKビルドスクリプト
```

## セキュリティ

- AWSクレデンシャルはCryptoJSで暗号化し、Tauriのアプリデータディレクトリに保存
- AWS API呼び出しはRustバックエンド経由（フロントエンドに認証情報は露出しない）
