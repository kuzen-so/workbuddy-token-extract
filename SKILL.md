---
name: workbuddy-token-extract
description: 一键提取 WorkBuddy 登录态中的 refreshToken（macOS，适配 5.6.2+ 客户端 AES-GCM 加密登录态）。通过 CDP 调试端口在客户端进程内取解密密钥，本地解密，全程不外传。触发词：提取 refreshToken、refresh token、签到 token、token 提取、换新 token。
version: "1.1.0"
license: MIT
---

# WorkBuddy refreshToken 一键提取

帮用户从本机 WorkBuddy 客户端登录态中提取 `refreshToken`（约 700 字符 JWT），主要用于金山文档 AirScript 云端自动签到等场景。

适用平台：**macOS**。WorkBuddy 5.6.2+ 登录态为 AES-256-GCM 加密信封，密钥只驻留客户端进程内存，必须走 CDP 提取；旧版明文登录态无需本 skill。

## ⚠️ 核心约束：提取必须由用户在终端手动运行

提取流程需要**退出并重启 WorkBuddy 客户端**。客户端退出时会连带杀掉 Agent 的执行环境——**Agent 绝不能自己运行提取命令**，否则流程会断在半路。

Agent 的职责只有三段：**前置检查 → 准备文件并给出命令 → 事后验证**。中间的重启运行交给用户在「终端」完成。

## ⚠️ 安全红线（必须遵守）

- **绝不把 refreshToken 明文打印到对话、终端或日志**。只报告：文件路径、字符长度、前 10 个字符 + `...` 供用户确认。
- token 等同账号钥匙，提醒用户**不要分享给任何人**（包括截图发群）。
- 网络访问仅本机 `127.0.0.1`（CDP）与腾讯官方接口，无任何第三方上报。

## 执行流程

### 第 1 步：断点续检（每次都先做）

先看是否已有历史产物，避免重复折腾：

```bash
ls -la ~/Desktop/workbuddy-token/refresh-token.txt 2>/dev/null
tail -5 ~/Desktop/workbuddy-token/extract.log 2>/dev/null
```

- 文件已存在 → 直接跳到第 4 步验证报告
- 日志显示失败 → 按排错表处理后重新走第 2 步

### 第 2 步：前置检查（不重启客户端，安全）

```bash
# Node >= 22（WebSocket 全局 API 需要）
node -v
# 已登录（文件存在即已登录）
ls "$HOME/Library/Application Support/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info"
# WorkBuddy 客户端存在
ls /Applications/WorkBuddy.app/Contents/MacOS/Electron
```

任一不满足则停下来告知用户（Node 装 22+；客户端需先登录）。

### 第 3 步：准备文件并给出运行命令

把解密脚本复制到用户输出目录：

```bash
mkdir -p ~/Desktop/workbuddy-token
cp <skill目录>/scripts/extract-final.mjs ~/Desktop/workbuddy-token/
```

然后**原样给出**下面这条命令，让用户打开「终端」粘贴运行：

```bash
cd ~/Desktop/workbuddy-token; osascript -e 'quit app "WorkBuddy"'; sleep 5; pkill -9 -f "WorkBuddy.app" ; sleep 2; nohup "/Applications/WorkBuddy.app/Contents/MacOS/Electron" --inspect=9339 >/tmp/wb-debug.log 2>&1 & sleep 10; node extract-final.mjs 9339; sleep 1; osascript -e 'quit app "WorkBuddy"'; sleep 2; open -a WorkBuddy
```

必须向用户说明：

- 客户端会自动重启两次，**约 30 秒**，聊天记录在云端不受影响
- 看到 `✓✓ refreshToken 已保存: .../refresh-token.txt` 即成功（同时会打印手机号明文，供核对解密正确性）
- 运行期间本对话会暂停，客户端恢复后回来说一声「好了」即可

### 第 4 步：事后验证（用户回来后）

```bash
ls -la ~/Desktop/workbuddy-token/refresh-token.txt 2>/dev/null
```

- 文件存在 → 读取字符数（**不读内容**）：`wc -c < ~/Desktop/workbuddy-token/refresh-token.txt`，按模板报告：

> ✅ 提取完成。refreshToken 已保存到 `~/Desktop/workbuddy-token/refresh-token.txt`（约 XXXX 字符，eyJhbGci... 开头）。
> ⚠️ 这是账号钥匙，不要发给任何人。有效期约 30 天，到期重跑一次本 skill 换新即可。

- 用户需要粘贴到金山文档表格 B1：提示**自己打开 txt 复制**，或经用户明确同意后写入剪贴板 `pbcopy < ~/Desktop/workbuddy-token/refresh-token.txt`（不要在对话中回显）。
- 文件不存在 → 让用户把终端输出发回来，按排错表处理。

## 排错

| 现象 | 处理 |
|---|---|
| `连不上 inspector 9339` | 客户端没起来或端口被占：`cat /tmp/wb-debug.log`；确认无安全软件拦截 |
| `Cannot find module` | extract-final.mjs 不在 `~/Desktop/workbuddy-token`，重做第 3 步复制 |
| `本地信封: 0 个` | 客户端是旧版（登录态明文），直接读文件里 `auth.accessToken` 即可，无需本 skill |
| `所有 target 都没拿到 loggerGet 结果` | 客户端版本变动导致绑定名变化，把终端输出完整发回分析 |
| `node: command not found` | 未装 Node 22+，nodejs.org 安装后重跑 |
| 手机号没命中 / 全部派生失败 | 把完整输出发回排查 |

## 进阶：extract.sh（可选，不建议 Agent 调用）

`scripts/extract.sh` 把全流程包成 nohup 脱离任务（前置检查 + 复制脚本 + 后台执行）。它适合用户自己在终端跑或配 cron，**Agent 仍然不要调用**——脱离进程能否在客户端退出后存活取决于执行环境，不可靠。

## 原理（给用户的一句话）

新版客户端把登录 token 加密存储、密钥只在客户端内存里。本 skill 带调试端口重启客户端（约 30 秒，自动恢复），从进程内取到密钥后在本地解密登录态文件——全程本机完成，无后端、不上传。
