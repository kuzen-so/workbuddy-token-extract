#!/bin/bash
# ============================================================
# WorkBuddy refreshToken 一键提取 runner（macOS）
#
# 作用：把「退出客户端 → 带调试端口重启 → 运行解密 → 恢复客户端」
#       整个流程放到脱离当前会话的后台执行。
#       因为 WorkBuddy 客户端退出时会连带杀掉 Agent 的本地 shell，
#       直接在前台跑一行命令会中途被杀——必须 nohup 脱离。
#
# 用法：extract.sh [输出目录]     # 默认 ~/Desktop/workbuddy-token
# 产物：<输出目录>/refresh-token.txt   提取结果
#       <输出目录>/extract.log         全程日志（已脱敏，不含 token 明文）
# ============================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${1:-$HOME/Desktop/workbuddy-token}"
mkdir -p "$OUT_DIR"

WB_APP="/Applications/WorkBuddy.app/Contents/MacOS/Electron"
[ -x "$WB_APP" ] || { echo "❌ 未找到 WorkBuddy 客户端：$WB_APP"; exit 1; }

# 0) 前置检查：Node >= 22（WebSocket 全局 API 需要）
NODE_BIN="${WB_EXTRACT_NODE:-$(command -v node 2>/dev/null)}"
if [ -z "$NODE_BIN" ]; then
  for c in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.local/share/fnm/node-versions"/*/installation/bin/node; do
    [ -x "$c" ] && NODE_BIN="$c" && break
  done
fi
[ -n "$NODE_BIN" ] || { echo "❌ 未找到 Node.js，请先安装 Node 22+（https://nodejs.org）"; exit 1; }
NODE_MAJOR="$("$NODE_BIN" -v | sed 's/^v//' | cut -d. -f1)"
[ "$NODE_MAJOR" -ge 22 ] 2>/dev/null || { echo "❌ Node 版本过低（$("$NODE_BIN" -v)），需要 22+"; exit 1; }

# 1) 前置检查：已登录（登录态文件存在）
AUTH_FILE="$HOME/Library/Application Support/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info"
[ -f "$AUTH_FILE" ] || { echo "❌ 未找到登录态文件，请先打开 WorkBuddy 客户端并登录"; exit 1; }

# 2) 复制解密脚本到输出目录（方便用户查看/留存）
cp "$SCRIPT_DIR/extract-final.mjs" "$OUT_DIR/extract-final.mjs"

# 3) 生成后台 runner 并脱离执行
RUNNER="$OUT_DIR/.runner.sh"
cat > "$RUNNER" <<EOF
#!/bin/bash
osascript -e 'quit app "WorkBuddy"' 2>/dev/null
sleep 5
pkill -9 -f "WorkBuddy.app" 2>/dev/null
sleep 2
nohup "$WB_APP" --inspect=9339 >/tmp/wb-debug.log 2>&1 &
sleep 10
"$NODE_BIN" "$OUT_DIR/extract-final.mjs" 9339
RC=\$?
sleep 1
osascript -e 'quit app "WorkBuddy"' 2>/dev/null
sleep 2
open -a WorkBuddy
echo "EXTRACT_EXIT=\$RC"
EOF
chmod +x "$RUNNER"

nohup "$RUNNER" > "$OUT_DIR/extract.log" 2>&1 &
echo "PID=$!"
echo "LOG=$OUT_DIR/extract.log"
echo "已启动后台提取，客户端将自动重启两次，约 30 秒完成。"
