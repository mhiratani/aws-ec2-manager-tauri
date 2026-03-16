#!/bin/bash
set -e

# Android APK ビルド & 署名スクリプト
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export ANDROID_HOME=$HOME/android-sdk
export NDK_HOME=$ANDROID_HOME/ndk/27.2.12479018
export PATH=$PATH:$HOME/.cargo/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

# ─── 変数定義 ─────────────────────────────────────────────────────────────────
KEYSTORE="$HOME/aws-ec2-manager-debug.keystore"
ALIAS="aws-ec2-manager"
STORE_PASS="android"
KEY_PASS="android"

APK_UNSIGNED="src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk"
APK_SIGNED="src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-signed.apk"

# ─── ビルド環境チェック ────────────────────────────────────────────────────────
echo "=== Checking build environment ==="
ERRORS=0

# Java チェック
if command -v java &>/dev/null; then
  JAVA_VER=$(java -version 2>&1 | head -1)
  echo "  [OK] Java        : $JAVA_VER"
else
  echo "  [NG] Java        : NOT FOUND"
  echo "       -> sudo apt install openjdk-17-jdk"
  ERRORS=$((ERRORS + 1))
fi

# JAVA_HOME チェック
if [ -d "$JAVA_HOME" ]; then
  echo "  [OK] JAVA_HOME   : $JAVA_HOME"
else
  echo "  [NG] JAVA_HOME   : NOT FOUND ($JAVA_HOME)"
  ERRORS=$((ERRORS + 1))
fi

# Android SDK チェック
if [ -d "$ANDROID_HOME/cmdline-tools/latest/bin" ]; then
  echo "  [OK] Android SDK : $ANDROID_HOME"
else
  echo "  [NG] Android SDK : NOT FOUND ($ANDROID_HOME/cmdline-tools/latest/bin)"
  ERRORS=$((ERRORS + 1))
fi

# NDK チェック
if [ -d "$NDK_HOME" ]; then
  echo "  [OK] NDK         : $NDK_HOME"
else
  echo "  [NG] NDK         : NOT FOUND ($NDK_HOME)"
  echo "       -> sdkmanager 'ndk;27.2.12479018'"
  ERRORS=$((ERRORS + 1))
fi

# Build Tools チェック
if [ -f "$ANDROID_HOME/build-tools/35.0.0/apksigner" ]; then
  echo "  [OK] Build Tools : 35.0.0"
else
  echo "  [NG] Build Tools : NOT FOUND"
  echo "       -> sdkmanager 'build-tools;35.0.0'"
  ERRORS=$((ERRORS + 1))
fi

# Rust チェック
if command -v cargo &>/dev/null; then
  CARGO_VER=$(cargo --version)
  echo "  [OK] Cargo       : $CARGO_VER"
else
  echo "  [NG] Cargo       : NOT FOUND"
  echo "       -> curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  ERRORS=$((ERRORS + 1))
fi

# Rust Android ターゲット チェック
MISSING_TARGETS=()
for target in aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android; do
  if rustup target list --installed 2>/dev/null | grep -q "^$target$"; then
    echo "  [OK] Rust target : $target"
  else
    echo "  [NG] Rust target : $target MISSING"
    MISSING_TARGETS+=("$target")
    ERRORS=$((ERRORS + 1))
  fi
done
if [ ${#MISSING_TARGETS[@]} -gt 0 ]; then
  echo "       -> rustup target add ${MISSING_TARGETS[*]}"
fi

# キーストア チェック（存在しない場合は自動生成）
if [ -f "$KEYSTORE" ]; then
  echo "  [OK] Keystore    : $KEYSTORE"
else
  echo "  [--] Keystore    : NOT FOUND -> 自動生成します..."
  if keytool -genkeypair -v \
    -keystore "$KEYSTORE" \
    -alias "$ALIAS" \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -storepass "$STORE_PASS" \
    -keypass "$KEY_PASS" \
    -dname "CN=Debug, OU=Debug, O=Debug, L=Debug, S=Debug, C=US" 2>/dev/null; then
    echo "  [OK] Keystore    : 生成しました -> $KEYSTORE"
  else
    echo "  [NG] Keystore    : 生成に失敗しました"
    ERRORS=$((ERRORS + 1))
  fi
fi

# node / npm チェック
if command -v npm &>/dev/null; then
  NPM_VER=$(npm --version)
  echo "  [OK] npm         : $NPM_VER"
else
  echo "  [NG] npm         : NOT FOUND"
  ERRORS=$((ERRORS + 1))
fi

echo ""
if [ $ERRORS -gt 0 ]; then
  echo "  !! $ERRORS error(s) found. Please fix the issues above before building."
  exit 1
else
  echo "  All checks passed!"
fi
echo ""

echo "=== Step 1: Frontend & APK build (arm64 only to reduce memory usage) ==="
npx tauri android build --apk --target aarch64

echo "=== Step 2: Sign APK ==="
$ANDROID_HOME/build-tools/35.0.0/apksigner sign \
  --ks "$KEYSTORE" \
  --ks-key-alias "$ALIAS" \
  --ks-pass pass:$STORE_PASS \
  --key-pass pass:$KEY_PASS \
  --out "$APK_SIGNED" \
  "$APK_UNSIGNED"

echo ""
echo "=== Build complete! ==="
ls -lh "$APK_SIGNED"
echo ""
echo "APK path: $(pwd)/$APK_SIGNED"
