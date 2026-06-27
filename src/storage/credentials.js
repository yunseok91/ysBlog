'use strict';

const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

// 저장 파일 경로: %APPDATA%/naver-blog-automation/credentials.json
function storePath() {
  return path.join(app.getPath('userData'), 'credentials.json');
}

// 디스크에서 원시 레코드 목록을 읽는다. 형식:
// [{ id, enc(base64) | pw(평문 fallback), encrypted: bool, savedAt }]
function readRaw() {
  try {
    const raw = fs.readFileSync(storePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeRaw(list) {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(list, null, 2), 'utf8');
}

function encryptPw(pw) {
  // 가능하면 OS 키체인(Windows DPAPI 등)으로 암호화한다.
  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    return { enc: safeStorage.encryptString(pw).toString('base64'), encrypted: true };
  }
  // 암호화를 못 쓰는 환경이면 평문으로 저장(경고 대상).
  return { pw, encrypted: false };
}

function decryptPw(rec) {
  if (rec.encrypted && rec.enc) {
    try {
      return safeStorage.decryptString(Buffer.from(rec.enc, 'base64'));
    } catch (_) {
      return '';
    }
  }
  return rec.pw || '';
}

// 계정 저장(같은 id가 있으면 갱신).
function saveAccount(id, pw) {
  if (!id) return;
  const list = readRaw();
  const idx = list.findIndex((r) => r.id === id);
  const rec = { id, ...encryptPw(pw), savedAt: new Date().toISOString() };
  if (idx >= 0) list[idx] = rec;
  else list.push(rec);
  writeRaw(list);
}

// 저장된 계정 목록(비밀번호는 복호화하지 않고 id만 노출).
function listAccounts() {
  return readRaw().map((r) => ({ id: r.id, encrypted: !!r.encrypted, savedAt: r.savedAt }));
}

// 특정 id의 비밀번호를 복호화해 돌려준다(폼 자동 채움용).
function getAccount(id) {
  const rec = readRaw().find((r) => r.id === id);
  if (!rec) return null;
  return { id: rec.id, pw: decryptPw(rec) };
}

function deleteAccount(id) {
  writeRaw(readRaw().filter((r) => r.id !== id));
}

module.exports = { saveAccount, listAccounts, getAccount, deleteAccount };
