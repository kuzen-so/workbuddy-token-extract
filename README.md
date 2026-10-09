# workbuddy-token-extract

一键提取 WorkBuddy 登录态中的 refreshToken（macOS）。做成 WorkBuddy skill，**不用复制长代码**——装好后对 WorkBuddy 说一句「帮我提取 refreshToken」即可。

适配 WorkBuddy **5.6.2+** 客户端的 AES-256-GCM 加密登录态：密钥只驻留客户端进程内存，本 skill 通过 CDP 调试端口在进程内取密钥、本地解密，全程本机完成，无后端、不上传。

## 安装

把这个仓库地址发给 WorkBuddy（或通过 ClawHub 安装 `@kuzen-so/workbuddy-token-extract`）：

```
https://github.com/kuzen-so/workbuddy-token-extract
```

## 使用

安装后对 WorkBuddy 说：

> 帮我提取 WorkBuddy 的 refreshToken

WorkBuddy 会自动完成前置检查（Node / 登录态）、把脚本放到 `~/Desktop/workbuddy-token/`，并给你一条运行命令。

**因为提取需要重启 WorkBuddy 客户端，最后一步需要你自己打开「终端」粘贴运行**（Agent 不能替你跑，否则客户端退出会中断流程）。约 30 秒，客户端自动重启两次，聊天记录不受影响。结果保存在 `~/Desktop/workbuddy-token/refresh-token.txt`，回到对话里 WorkBuddy 会帮你验证结果。

## 前提

| 依赖 | 说明 |
|---|---|
| macOS | Windows 用户可直接用内存扫描类签到 skill，无需本 skill |
| Node.js 22+ | [nodejs.org](https://nodejs.org) 安装 LTS 即可 |
| WorkBuddy 客户端已登录 | 登录态文件必须存在 |

## 提取后能干什么

最常见的用法：配合金山文档 AirScript 云端签到，**电脑关机也能每天自动领积分**。教程见：`https://github.com/kuzen-so/workbuddy-checkin`（文章《电脑关机也自动签到》）。

## 安全

- ⚠️ **refreshToken 等同账号钥匙**：不要发给任何人、不要截图分享
- token 仅保存在本地文件，skill 输出已脱敏（不回显明文）
- 全程仅访问本机 `127.0.0.1`（CDP），无任何第三方上报
- token 有效期约 30 天，到期重跑一次换新即可

## License

MIT
