---
name: workbuddy-token-extract
description: 一键提取 WorkBuddy 登录态中的 refreshToken（macOS，适配 5.6.2+ 客户端 AES-GCM 加密登录态）。通过 CDP 调试端口在客户端进程内取解密密钥，本地解密，全程不外传。触发词：提取 refreshToken、refresh token、签到 token、token 提取、换新 token。
version: "1.2.0"
license: MIT
---

# WorkBuddy refreshToken 一键提取

帮用户从本机 WorkBuddy 客户端登录态中提取 `refreshToken`（约 700 字符 JWT），用于金山文档 AirScript 云端自动签到等场景。

适用平台：**macOS**。WorkBuddy 5.6.2+ 登录态为 AES-256-GCM 加密信封，密钥只驻留客户端进程内存，必须走 CDP 提取。

## ⚠️ 行为规则（必须遵守）

1. 用户说「提取 refreshToken / 换 token / 签到 token」时，**立即执行下面三步，一气呵成**：自动创建脚本文件 → 自动给出运行命令 → 等用户回来验证。不要询问、不要只做检查就结束、不要去对比 GitHub 与本地版本。
2. 即使本地已有旧的 refresh-token.txt，也**照常执行三步**（用户可能就是要换新），只在报告里提一句旧文件的存在时间。
3. **绝不能由 Agent 自己运行提取命令**：提取需要退出并重启 WorkBuddy 客户端，客户端退出会杀掉 Agent 的执行环境。命令必须交给用户在「终端」运行。
4. **安全红线**：绝不打印/读取 refreshToken 明文，只报路径、字符数、前 10 字符。提醒用户勿分享。

## 执行三步

### 第 1 步：自动创建脚本文件（Agent 直接执行，不要问）

```bash
mkdir -p ~/Desktop/workbuddy-token
cp "$HOME/.workbuddy/skills/workbuddy-token-extract/scripts/extract-final.mjs" ~/Desktop/workbuddy-token/extract-final.mjs
chmod +x ~/Desktop/workbuddy-token/extract-final.mjs
```

### 第 2 步：前置检查（同一次回复里完成）

```bash
node -v || ls /opt/homebrew/bin/node /usr/local/bin/node
ls "$HOME/Library/Application Support/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info" 2>/dev/null && echo "已登录"
```

- Node < 22 或不存在 → 让用户先装 Node 22+（nodejs.org），装好再说「继续」
- 登录态文件不存在 → 让用户先打开 WorkBuddy 登录

### 第 3 步：原样给出运行命令（必须完整贴出）

前置检查通过后，**在回复中原样输出**下面整条命令，并附三行说明：

```bash
cd ~/Desktop/workbuddy-token; osascript -e 'quit app "WorkBuddy"'; sleep 5; pkill -9 -f "WorkBuddy.app" ; sleep 2; nohup "/Applications/WorkBuddy.app/Contents/MacOS/Electron" --inspect=9339 >/tmp/wb-debug.log 2>&1 & sleep 10; node extract-final.mjs 9339; sleep 1; osascript -e 'quit app "WorkBuddy"'; sleep 2; open -a WorkBuddy
```

> 请打开「终端」（Terminal），整条粘贴回车运行。
> - WorkBuddy 会自动重启两次，约 30 秒，聊天记录不受影响
> - 看到 `✓✓ refreshToken 已保存: .../refresh-token.txt` 即成功（会同时打印手机号明文，供核对解密正确）
> - 跑完回来说一声「好了」，我帮你验证

## 用户回来后：验证（不读内容）

```bash
F=~/Desktop/workbuddy-token/refresh-token.txt
ls -la "$F" 2>/dev/null && wc -c < "$F"
```

- 文件存在 → 按模板报告（**只报长度和前缀，不读内容**）：

> ✅ 提取完成。refreshToken 已保存到 `~/Desktop/workbuddy-token/refresh-token.txt`（约 XXXX 字符，eyJhbGci... 开头）。
> ⚠️ 这是账号钥匙，不要发给任何人、不要截图。有效期约 30 天，到期重跑本流程换新。

- 用户要填金山文档 B1 → 提示自己打开 txt 复制，或经同意后 `pbcopy < "$F"`（不要回显）。
- 文件不存在 → 让用户把终端完整输出发回来，按排错表处理。

## 排错

| 现象 | 处理 |
|---|---|
| `连不上 inspector 9339` | `cat /tmp/wb-debug.log`；确认无安全软件拦截，重跑命令 |
| `Cannot find module` | 第 1 步没执行成功，重跑 mkdir/cp |
| `本地信封: 0 个` | 客户端是旧版（登录态明文），无需本 skill，直接读 `auth.accessToken` |
| `所有 target 都没拿到 loggerGet 结果` | 客户端版本变动导致绑定名变化，把终端输出完整发回分析 |
| `node: command not found` | 未装 Node 22+，nodejs.org 安装后重跑 |
