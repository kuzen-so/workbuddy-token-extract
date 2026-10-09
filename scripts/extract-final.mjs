// extract-final.mjs —— WorkBuddy refreshToken 一键提取（macOS）
// 原理：客户端以 --inspect=9339 启动后，通过 CDP 在进程内调
//       electron.workbuddyStorage.loggerGet() 取 atRestSecretKey，
//       SHA256 派生密钥 → 重建 AAD → 本地 AES-256-GCM 解密登录态信封。
// 用法：node extract-final.mjs 9339
// 输出：本脚本同目录下 refresh-token.txt（并打印手机号明文供核对）
// 依赖：macOS + Node.js 22+，WorkBuddy 客户端已登录
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2]) || 9339;
const OUT_DIR = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(os.homedir(), 'Library/Application Support/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getWsList() {
  for (let i = 0; i < 15; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (res.ok) { const l = await res.json(); if (l.length) return l.map((t) => ({ ws: t.webSocketDebuggerUrl, type: t.type, title: t.title })); }
    } catch {}
    await sleep(1000);
  }
  throw new Error('连不上 inspector ' + PORT + '，请确认客户端已带 --inspect=9339 启动');
}
function evaluate(wsUrl, expr, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const t = setTimeout(() => { ws.close(); reject(new Error('超时')); }, timeoutMs);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === 1) { clearTimeout(t); ws.close(); if (m.result?.exceptionDetails) return reject(new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 600))); resolve(m.result?.result?.value); }
    };
    ws.onerror = () => { clearTimeout(t); reject(new Error('ws 错误')); };
  });
}

// ===== 1. 本地读信封 =====
const raw = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
const envs = {};
const walk = (o, p, d) => { if (typeof o === 'string') { if (p.endsWith('.envelope')) { try { envs[p] = JSON.parse(Buffer.from(o, 'base64').toString('utf8')); } catch {} return; } return; } if (o && typeof o === 'object' && d < 6) for (const k of Object.keys(o)) walk(o[k], p ? p + '.' + k : k, d + 1); };
walk(raw, '', 0);
console.log('本地信封:', Object.keys(envs).length, '个');
if (!Object.keys(envs).length) { console.log('!! 登录态里没有加密信封（可能客户端版本较旧，登录态本身是明文）'); process.exit(1); }

// ===== 2. inspector 遍历 target 拿 atRestSecretKey =====
const targets = await getWsList();
console.log('inspector targets:', targets.map((t) => `[${t.type}] ${t.title}`).join(' | '));
const EXPR = `(() => {
  const tried = [];
  let el = null;
  try { el = process.getBuiltinModule('electron'); if (el) tried.push('getBuiltinModule'); } catch {}
  if (!el) { try { el = process.mainModule && process.mainModule.require && process.mainModule.require('electron'); if (el) tried.push('mainModule.require'); } catch {} }
  if (!el) { try { const M = process.getBuiltinModule('node:module'); el = M.createRequire('/Applications/WorkBuddy.app/Contents/Resources/app.asar/package.json')('electron'); if (el) tried.push('createRequire'); } catch (e) { tried.push('createRequire失败:' + e.message); } }
  if (!el) return 'ERR:no-electron|' + tried.join(',');
  const ws = el.workbuddyStorage || (el.default && el.default.workbuddyStorage);
  if (!ws) return 'ERR:no-binding|via=' + tried.join(',') + '|keys=' + Object.keys(el).slice(0, 30).join(',');
  try { return JSON.stringify(ws.loggerGet()); } catch (e) { return 'ERR:loggerGet:' + e.message; }
})()`;
let lg = null;
for (const t of targets) {
  try {
    let v = await evaluate(t.ws, EXPR);
    console.log(`- target [${t.type}] ${t.title} → ${String(v).slice(0, 60)}`);
    let s = v;
    if (typeof s === 'string' && s.trim().startsWith('"')) { try { s = JSON.parse(s); } catch {} }
    if (s && typeof s === 'object' && s.atRestSecretKey) { lg = s; break; }
    if (typeof s === 'string' && s.trim().startsWith('{')) { try { lg = JSON.parse(s); if (lg.atRestSecretKey) break; lg = null; } catch {} }
  } catch (e) { console.log(`- target [${t.type}] ${t.title} → 跳过 (${String(e.message).slice(0, 80)})`); }
}
if (!lg) { console.log('!! 所有 target 都没拿到 loggerGet 结果'); process.exit(1); }
console.log('loggerGet 字段:', Object.keys(lg).join(','), '| version =', lg.version);
if (!lg.atRestSecretKey) {
  console.log('!! 没有 atRestSecretKey，完整返回:');
  console.log(JSON.stringify(lg).slice(0, 800));
  process.exit(1);
}

// ===== 3. 派生密钥并校验 keyId =====
const key = crypto.createHash('sha256').update(Buffer.from(lg.atRestSecretKey, 'utf8')).digest();
const keyId = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
console.log('派生密钥 32B，keyId =', keyId);

// ===== 4. AAD 变体空间暴力枚举（keyId 已验证正确，只差 AAD 字节布局）=====
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const st = (str) => { const b = Buffer.from(str, 'utf8'); return Buffer.concat([u32(b.length), b]); };
const QE = Buffer.from('WB-AAD\0', 'ascii');
const PURPOSE = 'workbuddy-auth-session';

function* combos() {
  for (const scheme of ['static-v1', 'asym-v1', 'sym-v1'])
    for (const magic of ['WBEV1', 'WBEA1'])
      for (const framingByte of [2, 1, 3, 4])
        for (const keyIdMode of ['hex', 'raw8'])
          for (const suiteMode of ['u32', 'byte'])
            for (const purpose of [PURPOSE, null])
              for (const resource of ['auth/workbuddy-desktop.info', 'workbuddy-desktop.info', null])
                for (const fpMode of ['present', 'bare', 'zero'])
                  for (const mid of [0, null])
                    for (const tail of [0, 1, 2, null])
                      yield { scheme, magic, framingByte, keyIdMode, suiteMode, purpose, resource, fpMode, mid, tail };
}
function buildAad(c, keyIdHex, fp) {
  const parts = [QE, Buffer.from([1]), st(c.magic), st(c.scheme)];
  parts.push(c.suiteMode === 'u32' ? u32(1) : Buffer.from([1]));
  parts.push(c.keyIdMode === 'hex' ? st(keyIdHex) : Buffer.from(keyIdHex, 'hex'));
  parts.push(Buffer.from([c.framingByte]));
  if (c.purpose !== null) parts.push(st(c.purpose));
  if (c.resource !== null) parts.push(st(c.resource));
  if (c.fpMode === 'present') parts.push(Buffer.from([1]), st(fp));
  else if (c.fpMode === 'bare') parts.push(st(fp));
  else if (c.fpMode === 'zero') parts.push(Buffer.from([0]));
  if (c.mid !== null) parts.push(Buffer.from([c.mid]));
  if (c.tail !== null) parts.push(Buffer.from([c.tail]));
  return Buffer.concat(parts);
}
const tryGcm = (e, aad) => {
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(e.nonce, 'base64'), { authTagLength: 16 });
    d.setAAD(aad);
    d.setAuthTag(Buffer.from(e.authTag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(e.ciphertext, 'base64')), d.final()]).toString('utf8');
  } catch { return null; }
};

// ===== 5. 手机号信封做验证器（明文必为 7~15 位数字），命中后解全部 =====
const fieldPathOf = (p) => '/' + p.replace(/\.envelope$/, '').split('.').join('/');
const phoneEntry = Object.entries(envs).find(([p]) => p.includes('phoneNumber'));
const results = {};
let token = null;
if (phoneEntry) {
  const [pp, pe] = phoneEntry;
  const fpPhone = fieldPathOf(pp);
  let hit = null, tried = 0;
  for (const c of combos()) {
    tried++;
    const pt = tryGcm(pe, buildAad(c, pe.keyId, fpPhone));
    if (pt !== null && /^\+?\d{7,15}$/.test(pt)) { hit = { c, pt }; break; }
  }
  console.log(`AAD 枚举 ${tried} 组合 →`, hit ? `命中！手机号=${hit.pt}` : '全部失败');
  if (hit) {
    for (const [p, e] of Object.entries(envs)) {
      const fp = fieldPathOf(p);
      const pt = tryGcm(e, buildAad(hit.c, e.keyId, fp));
      if (pt !== null) {
        results[p] = pt;
        // token 类字段只报长度不回显内容，防止敏感凭据进入日志/终端
        const shown = /token/i.test(p) ? `(len=${pt.length}, 已脱敏)` : (pt.length > 120 ? pt.slice(0, 80) + `...(len=${pt.length})` : pt);
        console.log(`✓ ${fp} → ${shown}`);
        if (p.includes('refreshToken')) token = pt;
      } else console.log(`✗ ${fp} 同参数解密失败`);
    }
  }
} else {
  console.log('!! 没找到 phoneNumber 信封');
}

if (token) {
  const out = path.join(OUT_DIR, 'refresh-token.txt');
  fs.writeFileSync(out, token);
  console.log('\n✓✓ refreshToken 已保存:', out, '| 长度', token.length);
} else {
  console.log('\n未拿到 refreshToken，请把上面的完整输出发回来排查');
  process.exit(1);
}