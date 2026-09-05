#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT="$ROOT/dist/output"
OUTPUT_RESOURCE="$ROOT/dist/output_resource"
OUTPUT_STATIC="$ROOT/dist/output_static"

# 映射平台环境变量到 preset 期望的变量名
#   MIAODA_APP_ID            → /app/<appId> 作为客户端 base path
#   MIAODA_RESOURCE_CDN_PREFIX → assets (JS/CSS) 的 CDN 前缀
# CLI 注入约定见 miaoda-cli src/services/deploy/modern/atoms/build.ts
export CLIENT_BASE_PATH="${MIAODA_APP_ID:+/app/$MIAODA_APP_ID}"
export ASSETS_CDN_PATH="${MIAODA_RESOURCE_CDN_PREFIX:-/}"
export STATIC_ASSETS_BASE_URL="${MIAODA_STATIC_CDN_PREFIX}"
export NODE_ENV="${NODE_ENV:-production}"

# 清理
rm -rf "$ROOT/dist"

# 1. Vite 构建 → dist/client/（相对于项目根目录输出）
npx vite build --outDir "$ROOT/dist/client" --emptyOutDir

# 2. public/ 静态资源 + HTML → dist/output/（模型 B：public = 应用根目录，同源 /app/<appId>/*）
mkdir -p "$OUTPUT"
# 2a. public/*：vite copyPublicDir 已把 public/* 平铺进 dist/client，但下面白名单只取
#     *.html/routes.json，其余（favicon / 图片 / 运行时 fetch 的数据文件）会随 dist/client 被删。
#     从源 public/ 补拷到 output/（同源根），让 fetch('/x') / resolveAppUrl('/x') 线上可用。
#     先拷 public、再拷 HTML，保证构建产出的 index.html/routes.json 覆盖 public 里的同名文件（若有）。
if [ -d "$ROOT/public" ]; then
  cp -R "$ROOT/public/." "$OUTPUT/"
fi
# 2b. HTML + routes.json（构建产物）
find "$ROOT/dist/client" -maxdepth 1 \( -name '*.html' -o -name 'routes.json' \) -exec cp {} "$OUTPUT/" \;

# 3. assets/ → dist/output_resource/（JS/CSS/字体，上传到 CDN）
if [ -d "$ROOT/dist/client/assets" ]; then
  mkdir -p "$OUTPUT_RESOURCE"
  cp -r "$ROOT/dist/client/assets" "$OUTPUT_RESOURCE/"
fi

# 4. 私有静态资源 → dist/output_static/（排除代码文件）
if [ -d "$ROOT/shared/static" ]; then
  mkdir -p "$OUTPUT_STATIC"
  rsync -a --exclude='*.ts' --exclude='*.tsx' --exclude='*.js' --exclude='*.jsx' "$ROOT/shared/static/" "$OUTPUT_STATIC/"
fi

# 5. capability 配置 → dist/output_capabilities/
if [ -d "$ROOT/shared/capabilities" ]; then
  mkdir -p "$ROOT/dist/output_capabilities"
  cp -r "$ROOT/shared/capabilities/." "$ROOT/dist/output_capabilities/"
fi

# 清理中间产物
rm -rf "$ROOT/dist/client"

echo "Build complete"
echo "  HTML         → dist/output/"
[ -d "$OUTPUT_RESOURCE" ] && echo "  Resource     → dist/output_resource/" || true
[ -d "$OUTPUT_STATIC" ] && echo "  Static       → dist/output_static/" || true
[ -d "$ROOT/dist/output_capabilities" ] && echo "  Capabilities → dist/output_capabilities/" || true
