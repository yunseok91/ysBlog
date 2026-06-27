'use strict';

const { BrowserWindow, session } = require('electron');

const LOGIN_URL =
  'https://nid.naver.com/nidlogin.login?mode=form&url=https://www.naver.com/';

// 사람처럼 보이는 최신 크롬 User-Agent / 헤더 값.
const HUMAN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const HUMAN_HEADERS = {
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'sec-ch-ua': '"Google Chrome";v="126", "Chromium";v="126", "Not.A/Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Upgrade-Insecure-Requests': '1',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => min + Math.random() * (max - min);

// 사람의 타이핑 리듬을 흉내내는 랜덤 지연.
function keyDelay() {
  return rand(70, 180);
}

let loginWin = null;

// 자동화에 사용할 세션에 사람 같은 헤더를 주입한다.
function applyHumanHeaders(ses) {
  ses.setUserAgent(HUMAN_UA, HUMAN_HEADERS['Accept-Language']);
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const headers = { ...details.requestHeaders, ...HUMAN_HEADERS };
    cb({ requestHeaders: headers });
  });
}

// 선택자로 요소의 화면상 중심 좌표를 구한다.
async function elementCenter(wc, selector) {
  const rect = await wc.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, visible: r.width > 0 && r.height > 0 };
  })()`);
  return rect;
}

// 실제 마우스 이벤트로 요소를 클릭(포커스)한다.
async function realClick(wc, selector) {
  const c = await elementCenter(wc, selector);
  if (!c || !c.visible) throw new Error(`요소를 찾을 수 없음: ${selector}`);
  const x = Math.round(c.x);
  const y = Math.round(c.y);
  wc.sendInputEvent({ type: 'mouseMove', x, y });
  await sleep(rand(40, 120));
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  await sleep(rand(30, 80));
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
}

// 포커스된 입력란에 한 글자씩 실제 키 이벤트를 보낸다.
async function typeHuman(wc, text) {
  for (const ch of String(text)) {
    wc.sendInputEvent({ type: 'keyDown', keyCode: ch });
    wc.sendInputEvent({ type: 'char', keyCode: ch });
    wc.sendInputEvent({ type: 'keyUp', keyCode: ch });
    await sleep(keyDelay());
  }
}

// 입력란을 클릭해 포커스한 뒤 사람처럼 타이핑한다.
async function fillField(wc, selector, value) {
  await realClick(wc, selector);
  await sleep(rand(120, 300));
  await typeHuman(wc, value);
}

// 로그인 폼 입력란 선택자를 후보 중에서 탐지한다.
async function detectSelectors(wc) {
  return wc.executeJavaScript(`(() => {
    const pick = (cands) => cands.find((s) => document.querySelector(s)) || null;
    return {
      id: pick(['#id', 'input[name="id"]', '#account input[type="text"]']),
      pw: pick(['#pw', 'input[name="pw"]', '#account input[type="password"]']),
      keep: pick(['#keep', '#nvlong']),
      submit: pick(['#log\\\\.login', '.btn_login', 'button[type="submit"]', '#frmNIDLogin .btn_login']),
    };
  })()`);
}

// 현재 URL이 로그인 성공 상태인지 판정한다.
function isLoggedIn(url) {
  if (!url) return false;
  // 로그인 페이지를 벗어나 naver.com 으로 이동하면 성공으로 본다.
  if (url.includes('nidlogin.login')) return false;
  if (url.includes('nid.naver.com/nidlogin')) return false;
  return /naver\.com/.test(url);
}

/**
 * 네이버 로그인 자동화 실행.
 * @param {{id:string, pw:string, onStatus?:(stage:string,msg:string)=>void, show?:boolean}} opts
 * @returns {Promise<{success:boolean, url:string, message:string}>}
 */
async function runLogin({ id, pw, onStatus = () => {}, show = true } = {}) {
  if (!id || !pw) throw new Error('아이디와 비밀번호를 모두 입력해 주세요.');

  // 자동화 전용 파티션 세션(쿠키 유지 가능).
  const ses = session.fromPartition('persist:naver-auto');
  applyHumanHeaders(ses);

  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.destroy();
    loginWin = null;
  }

  loginWin = new BrowserWindow({
    width: 1200,
    height: 820,
    show,
    title: '네이버 로그인 (자동화)',
    webPreferences: {
      session: ses,
      partition: 'persist:naver-auto',
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const wc = loginWin.webContents;
  wc.setUserAgent(HUMAN_UA);

  onStatus('navigate', '로그인 페이지를 여는 중...');
  await wc.loadURL(LOGIN_URL);
  await sleep(rand(700, 1400)); // 사람이 페이지를 훑어보는 시간

  const sel = await detectSelectors(wc);
  if (!sel.id || !sel.pw) {
    throw new Error('로그인 입력란을 찾지 못했습니다. 페이지 구조가 바뀌었을 수 있습니다.');
  }

  onStatus('typing-id', '아이디를 입력하는 중...');
  await fillField(wc, sel.id, id);
  await sleep(rand(300, 700));

  onStatus('typing-pw', '비밀번호를 입력하는 중...');
  await fillField(wc, sel.pw, pw);
  await sleep(rand(300, 700));

  // 로그인 성공 시 페이지 이동을 감지하기 위한 대기 설정.
  const navigated = new Promise((resolve) => {
    const onNav = () => {
      const url = wc.getURL();
      if (isLoggedIn(url)) {
        cleanup();
        resolve({ success: true, url });
      }
    };
    const cleanup = () => {
      wc.removeListener('did-navigate', onNav);
      wc.removeListener('did-navigate-in-page', onNav);
    };
    wc.on('did-navigate', onNav);
    wc.on('did-navigate-in-page', onNav);
    // 타임아웃: 캡차/2차인증 등으로 자동 진행이 막힐 수 있음.
    setTimeout(() => {
      cleanup();
      resolve({ success: isLoggedIn(wc.getURL()), url: wc.getURL(), timedOut: true });
    }, 25000);
  });

  onStatus('submit', '로그인 버튼을 누르는 중...');
  if (sel.submit) {
    await realClick(wc, sel.submit);
  } else {
    // 버튼을 못 찾으면 비밀번호 입력란에서 Enter.
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  }

  const result = await navigated;

  if (result.success) {
    onStatus('done', '로그인 성공!');
    return { success: true, url: result.url, message: '로그인에 성공했습니다.' };
  }

  // 실패: 화면의 오류 메시지를 긁어온다(캡차/잘못된 정보 등).
  let errMsg = '';
  try {
    errMsg = await wc.executeJavaScript(`(() => {
      const e = document.querySelector('.error_message, .react-modal__message, #err_common');
      return e ? e.innerText.trim() : '';
    })()`);
  } catch (_) {}

  const reason = result.timedOut
    ? (errMsg || '자동 진행이 멈췄습니다. 캡차/2차 인증을 직접 처리한 뒤 다시 시도하세요.')
    : (errMsg || '로그인에 실패했습니다. 아이디/비밀번호를 확인하세요.');

  onStatus('error', reason);
  return { success: false, url: wc.getURL(), message: reason };
}

// 로그인된 브라우저 창을 글쓰기 페이지로 이동시킨다(같은 세션 유지).
async function openWritePage(blogId = 'ys_note91') {
  const url = `https://blog.naver.com/${blogId}?Redirect=Write`;
  if (!loginWin || loginWin.isDestroyed()) {
    // 로그인 창이 닫혀 있으면 같은 파티션 세션으로 새로 띄운다.
    const ses = session.fromPartition('persist:naver-auto');
    applyHumanHeaders(ses);
    loginWin = new BrowserWindow({
      width: 1280,
      height: 900,
      title: '네이버 블로그 글쓰기',
      webPreferences: { partition: 'persist:naver-auto', contextIsolation: true, nodeIntegration: false },
    });
    loginWin.webContents.setUserAgent(HUMAN_UA);
  }
  loginWin.show();
  loginWin.focus();
  const wc = loginWin.webContents;

  // 로그인 직후 finalize → www.naver.com 리다이렉트가 진행 중이면
  // 우리의 loadURL 이 그 리다이렉트에 덮어써진다. 이동이 글쓰기 페이지에
  // 안착할 때까지 몇 번 재시도한다.
  const arrived = (u) => /blog\.naver\.com/.test(u) || /PostWrite|postwrite|Redirect=Write/i.test(u);

  let finalUrl = '';
  for (let attempt = 1; attempt <= 4; attempt++) {
    console.log(`[openWritePage] attempt ${attempt} -> ${url}`);
    try {
      await wc.loadURL(url);
    } catch (e) {
      // 진행 중이던 다른 리다이렉트에 가로채이면 ERR_ABORTED(-3). 정상 흐름.
      if (!String(e).includes('ERR_ABORTED')) {
        console.error('[openWritePage] loadURL error:', e);
      }
    }
    await sleep(1300); // 리다이렉트 체인이 안착할 시간
    finalUrl = wc.getURL();
    console.log(`[openWritePage] attempt ${attempt} final =`, finalUrl);
    if (arrived(finalUrl)) break;
    await sleep(500); // 메인으로 튕겼으면 잠시 후 재시도
  }

  console.log('[openWritePage] DONE final URL =', finalUrl);
  return { url, finalUrl };
}

function getLoginWindow() {
  return loginWin && !loginWin.isDestroyed() ? loginWin : null;
}

function closeLoginWindow() {
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.destroy();
    loginWin = null;
  }
}

module.exports = { runLogin, closeLoginWindow, openWritePage, getLoginWindow, LOGIN_URL };
