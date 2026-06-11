#!/usr/bin/env bash
# 打包脑力守护扩展为可上传 / 可加载的 zip。
# 用法：scripts/build.sh [version]
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${1:-$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")}"
OUT_DIR="dist"
ZIP_NAME="brain-protector-v${VERSION}.zip"

# 生成图标（若缺失）
if [ ! -f icons/icon128.png ]; then
  python3 icons/gen_icons.py
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# 扩展运行时实际需要的文件
INCLUDE=(
  manifest.json
  background.js
  src
  vendor
  content-scripts
  newtab
  dashboard
  options
  rules
  icons/icon16.png
  icons/icon48.png
  icons/icon128.png
)

zip -r -q "$OUT_DIR/$ZIP_NAME" "${INCLUDE[@]}"

echo "✓ 打包完成: $OUT_DIR/$ZIP_NAME"
unzip -l "$OUT_DIR/$ZIP_NAME" | tail -n +2 | head -n 40
