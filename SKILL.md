---
name: workbuddy-token-extract
description: 一键提取 WorkBuddy 登录态中的 refreshToken（macOS，适配 5.6.2+ 客户端 AES-GCM 加密登录态）。通过 CDP 调试端口在客户端进程内取解密密钥，本地解密，全程不外传。触发词：提取 refreshToken、refresh token、签到 token、token 提取、换新 token。
version: "1.0.0"
license: MIT
---

# WorkBuddy refreshToken 一键提取

帮用户从本机 WorkBuddy 客户端登录态中提取 `refreshToken`（约 700 字符 JWT），主要用于金山文档 AirScript 云端自动签到等场景。

适用平台：**macOS**。WorkBuddy 5.6.2+ 登录态为 AES-256-GCM 加密信封，密钥只驻留客户端进程内存，必须走 CDP 提取；旧版明文登录态无需本 skill。

## ⚠️ 安全红线（必须遵守）

- **绝不把 refreshToken 明文打印到对话、终端或日志**。只报告：文件路径、字符长度、前 10 个字符 + `...` 供用户确认。
- token 等同账号钥匙，提醒用户**不要分享给任何人**（包括截图发群）。
- 网络访问仅本机 `127.0.0.1`（CDP）与腾讯官方接口，无任何第三方上报。

## 执行流程

### 第 1 步：前置检查（不重启客户端，安全）

```bash
# Node >= 22
node -v
# 已登录（文件存在即已登录）
ls "$HOME/Library/Application Support/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info"
# WorkBuddy 客户端存在
ls /Applications/WorkBuddy.app/Contents/MacOS/Electron
```

任一不满足则停下来告知用户（Node 装 22+；客户端需先登录）。

### 第 2 步：后台执行提取

```bash
chmod +x <skill目录>/scripts/extract.sh
<skill目录>/scripts/extract.sh           # 默认输出到 ~/Desktop/workbuddy-token
```

脚本会把全流程（退出客户端 → `--inspect=9339` 重启 → 解密 → 恢复客户端）放进 **nohup 脱离会话** 的后台执行。**必须这样做**：WorkBuddy 退出时会连带杀掉 Agent 的本地 shell，前台直接跑会在中途被杀。

### 第 3 步：轮询结果（约 30~60 秒）

```bash
for i in $(seq 1 30); do
  grep -q "EXTRACT_EXIT" ~/Desktop/workbuddy-token/extract.log 2>/dev/null && break
  sleep 3
done
tail -30 ~/Desktop/workbuddy-token/extract.log
ls -la ~/Desktop/workbuddy-token/refresh-token.txt 2>/dev/null
```

- 日志出现 `✓✓ refreshToken 已保存` 且 `EXTRACT_EXIT=0` → 成功
- 出现 `AAD 枚举 … 命中！手机号=1xx…` 属正常（用手机号明文校验解密正确性）
- `EXTRACT_EXIT` 非 0 或未产出文件 → 按下方排错处理

### 第 4 步：向用户报告（脱敏）

报告模板：

> ✅ 提取完成。refreshToken 已保存到 `~/Desktop/workbuddy-token/refresh-token.txt`（约 XXXX 字符，eyJhbGci... 开头）。
> ⚠️ 这是账号钥匙，不要发给任何人。有效期约 30 天，到期重跑一次本 skill 换新即可。
> 客户端已自动恢复，聊天记录不受影响。

如用户需要粘贴到金山文档表格 B1，提示用户**自己打开 txt 复制**，或经用户明确同意后由 Agent 读取并写入剪贴板：`pbcopy < ~/Desktop/workbuddy-token/refresh-token.txt`（不要在对话中回显）。

## 排错

| 现象 | 处理 |
|---|---|
| `连不上 inspector 9339` | 客户端没起来或端口被占：`cat /tmp/wb-debug.log`；确认无安全软件拦截 |
| `Cannot find module` | extract-final.mjs 不在输出目录，重跑 extract.sh 会自动复制 |
| `本地信封: 0 个` | 客户端是旧版（登录态明文），直接读文件里 `auth.accessToken` 即可，无需本 skill |
| `所有 target 都没拿到 loggerGet 结果` | 客户端版本变动导致绑定名变化，把 extract.log 完整发回分析 |
| Node 未找到 / 版本 < 22 | 让用户安装 Node 22+，或设 `WB_EXTRACT_NODE=<路径>` 指定 |
| 全程卡住 | `pkill -f .runner.sh` 后重跑；确认磁盘可写 |

## 原理（给用户的一句话）

新版客户端把登录 token 加密存储、密钥只在客户端内存里。本 skill 带调试端口重启客户端（约 30 秒，自动恢复），从进程内取到密钥后在本地解密登录态文件——全程本机完成，无后端、不上传。
