'use strict';

const { clipboard, nativeImage } = require('electron');
const { getLoginWindow, openWritePage } = require('./naverLogin');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 마크다운을 에디터에 넣을 평문으로 가볍게 정리한다.
// (SmartEditor 헤딩 스타일 적용은 다음 단계 과제. 지금은 텍스트만 안정적으로 입력.)
function mdLineToPlain(line) {
  return line
    .replace(/^\s{0,3}#{1,6}\s*/, '') // # 헤딩 마커 제거
    .replace(/\*\*(.+?)\*\*/g, '$1') // **굵게** → 텍스트
    .replace(/^\s*[-*]\s+/, '· ') // 리스트 불릿 정리
    .trimEnd();
}

// 긴 문단을 문장 단위로 쪼갠다(네이버 모바일 가독성).
function splitSentences(text) {
  // 한글 종결어미 + 문장부호 뒤 공백에서 분리. (1.5km 같은 숫자는 안 깨짐)
  const parts = text.split(/(?<=[가-힣][.!?])\s+/);
  return parts.map((s) => s.trim()).filter(Boolean);
}

// 본문을 블록 배열로 변환.
//  - [IMGn] 토큰은 문장 중간에 붙어 있어도 독립 이미지 블록으로 분리
//  - ##/### 헤딩은 heading 레벨을 표시(굵게 처리용)
//  - 긴 일반 문단은 문장 단위로 줄바꿈
function bodyToBlocks(body) {
  let normalized = String(body).replace(/[ \t]*(\[\s*IMG\s*\d*\s*\])[ \t]*/gi, '\n$1\n');
  normalized = normalized.replace(/\n{3,}/g, '\n\n');

  const blocks = [];
  for (const raw of normalized.split('\n')) {
    const line = raw.trim();

    const im = line.match(/^\[\s*IMG\s*(\d*)\s*\]$/i);
    if (im) {
      blocks.push({ type: 'img', index: im[1] ? parseInt(im[1], 10) : 0 });
      continue;
    }
    // 평점(이모지, 굵게) / 한줄평(빨강, 굵게)
    const rt = line.match(/^\[RATING\]\s*(.*)$/i);
    if (rt) {
      blocks.push({ type: 'rating', text: rt[1].trim() });
      continue;
    }
    const rv = line.match(/^\[REVIEW\]\s*(.*)$/i);
    if (rv) {
      blocks.push({ type: 'review', text: rv[1].trim() });
      continue;
    }
    const dc = line.match(/^\[DISCLOSURE\]\s*(.*)$/i);
    if (dc) {
      blocks.push({ type: 'disclosure', text: dc[1].trim() });
      continue;
    }
    const pr = line.match(/^\[PRODUCT\]\s*(.*)$/i);
    if (pr) {
      const parts = pr[1].split('|');
      const url = (parts.length >= 2 ? parts.slice(1).join('|') : parts[0]).trim();
      const name = parts.length >= 2 ? parts[0].trim() : '';
      blocks.push({ type: 'product', name, url });
      continue;
    }
    if (line === '') {
      blocks.push({ type: 'blank' });
      continue;
    }

    // 헤딩(##, ###) → 굵게 강조 블록
    const h = line.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      const text = h[2].replace(/\*\*(.+?)\*\*/g, '$1').trim();
      blocks.push({ type: 'text', text, heading: h[1].length });
      continue;
    }

    const isList = /^\s*([-*]|\d+[.)])\s+/.test(line);
    const plain = mdLineToPlain(line);
    if (isList || plain.length < 40) {
      blocks.push({ type: 'text', text: plain });
    } else {
      // 긴 문단은 문장마다 줄바꿈
      for (const s of splitSentences(plain)) blocks.push({ type: 'text', text: s });
    }
  }
  return blocks;
}

// webContents 의 모든 프레임을 순회하며 SmartEditor 가 있는 프레임을 찾는다.
async function findEditorFrame(wc, onLog = () => {}) {
  const frames = wc.mainFrame.framesInSubtree;
  onLog(`프레임 ${frames.length}개 탐색`);
  for (const f of frames) {
    onLog(`  - frame: ${f.url}`);
    try {
      const has = await f.executeJavaScript(
        `!!document.querySelector('.se-section-documentTitle, .se-documentTitle, .se-content, .se-section-text, .se-component')`
      );
      if (has) {
        onLog(`  ✓ 에디터 프레임 발견: ${f.url}`);
        return f;
      }
    } catch (e) {
      onLog(`  (frame JS 실패: ${String(e).slice(0, 60)})`);
    }
  }
  return null;
}

// 에디터 프레임의 제목/본문 후보 구조를 진단용으로 덤프한다.
async function dumpEditorDom(frame, onLog = () => {}) {
  const info = await frame.executeJavaScript(`(() => {
    const brief = (el) => el ? {
      tag: el.tagName.toLowerCase(),
      cls: (el.className || '').toString().slice(0, 80),
      editable: el.getAttribute && el.getAttribute('contenteditable'),
      ph: el.getAttribute && (el.getAttribute('data-placeholder') || el.getAttribute('placeholder') || ''),
      html: (el.outerHTML || '').slice(0, 160),
    } : null;
    const editables = [...document.querySelectorAll('[contenteditable="true"]')].slice(0, 6).map(brief);
    const titleArea = document.querySelector('[class*="documentTitle" i], .se-section-documentTitle');
    const textArea = document.querySelector('[class*="se-section-text" i], [class*="se-content" i]');
    // 툴바: 문단스타일/글자크기 등 컨트롤 후보 (다음 단계 헤딩 스타일 적용용)
    const toolbar = [...document.querySelectorAll('button, [role="button"], select')]
      .filter((e) => /본문|제목|소제목|인용|크기|단락|스타일/.test((e.textContent || '') + (e.getAttribute('aria-label') || '')))
      .slice(0, 20)
      .map((e) => ({
        txt: (e.textContent || '').trim().slice(0, 16),
        aria: (e.getAttribute('aria-label') || '').slice(0, 24),
        cls: (e.className || '').toString().slice(0, 50),
      }));
    return {
      url: location.href,
      editableCount: document.querySelectorAll('[contenteditable="true"]').length,
      editables,
      titleArea: brief(titleArea),
      textArea: brief(textArea),
      toolbar,
    };
  })()`).catch((e) => ({ error: String(e) }));
  onLog('=== 에디터 DOM 덤프 ===');
  onLog(JSON.stringify(info, null, 2));
  return info;
}

// 로딩 시 뜨는 팝업(작성 중 글 이어쓰기, 도움말 등)을 닫는다.
// "이전에 작성된 글" 팝업은 '취소'를 눌러 새 글로 시작한다.
async function dismissPopups(frame, onLog = () => {}) {
  const result = await frame.executeJavaScript(`(() => {
    const log = [];
    const visible = (el) => el && el.offsetParent !== null;
    const clickByText = (texts, root) => {
      const btns = [...(root || document).querySelectorAll('button, a, [role="button"]')];
      for (const b of btns) {
        const t = (b.textContent || '').trim();
        if (texts.some((x) => t === x) && visible(b)) { b.click(); return t; }
      }
      return null;
    };

    // 1) 모달/팝업/다이얼로그 컨테이너 탐색
    const popups = [...document.querySelectorAll(
      '[class*="popup" i], [class*="layer" i], [class*="modal" i], [role="dialog"], [role="alertdialog"]'
    )].filter(visible);

    for (const p of popups) {
      const txt = (p.innerText || '').replace(/\\s+/g, ' ').trim();
      // 작성 중/저장된 글 이어쓰기 팝업 → 취소(새 글)
      if (/작성|저장|이어|불러|임시/.test(txt)) {
        // 진단용: 팝업 텍스트 + 버튼 목록 기록
        const btns = [...p.querySelectorAll('button, a')].map((b) => (b.textContent || '').trim()).filter(Boolean);
        log.push('draftPopup{text:"' + txt.slice(0, 50) + '", btns:[' + btns.join('/') + ']}');
        const hit = clickByText(['취소', '아니오', '아니요', '새로 작성', '새 글', '닫기'], p);
        if (hit) log.push('clicked:' + hit);
      }
    }

    // 2) 도움말/가이드/툴팁 닫기 (X 버튼) — 팝업 내부로 한정
    for (const p of popups) {
      p.querySelectorAll('button[aria-label*="닫기"], button[title*="닫기"], [class*="close" i]').forEach((b) => {
        if (visible(b)) { try { b.click(); log.push('close'); } catch (e) {} }
      });
    }
    return log;
  })()`).catch((e) => ['err:' + String(e).slice(0, 60)]);
  if (result.length) onLog('팝업 처리: ' + result.join(' | '));
  return result;
}

// 글쓰기 창의 에디터 프레임을 찾아 팝업을 닫는다(지연 등장 대비 재시도).
async function dismissEditorPopups({ onLog = () => {}, tries = 5 } = {}) {
  const win = getLoginWindow();
  if (!win) return;
  const wc = win.webContents;
  let frame = null;
  for (let i = 0; i < tries; i++) {
    frame = frame || (await findEditorFrame(wc, () => {}));
    if (frame) {
      const r = await dismissPopups(frame, onLog);
      // 팝업을 실제로 처리했으면 한 번 더 확인 후 종료
      if (r.some((x) => x.startsWith('clicked'))) {
        await sleep(400);
        await dismissPopups(frame, onLog);
        return;
      }
    }
    await sleep(600);
  }
}

// SmartEditor 의 제목/본문은 실제 마우스 클릭으로만 캐럿이 잡힌다.
// 에디터가 iframe 안이므로 (iframe 화면좌표 + 요소좌표) 를 합산해 클릭한다.
async function realClickInEditor(wc, mainFrame, editorFrame, selectors, onLog = () => {}) {
  // 1) 에디터 iframe 내부에서 대상 요소의 위치(뷰포트 기준) 구하기
  const target = await editorFrame.executeJavaScript(`(() => {
    const cands = ${JSON.stringify(selectors)};
    for (const s of cands) {
      const el = document.querySelector(s);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          return { sel: s, x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 18) };
        }
      }
    }
    return null;
  })()`).catch(() => null);
  if (!target) {
    onLog('  클릭 대상 못 찾음');
    return null;
  }

  // 2) 메인 프레임에서 에디터 iframe 의 화면상 위치(오프셋) 구하기
  const off = await mainFrame.executeJavaScript(`(() => {
    const f = document.querySelector('iframe#mainFrame') || document.querySelector('iframe');
    const r = f ? f.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: r.left, y: r.top };
  })()`).catch(() => ({ x: 0, y: 0 }));

  const x = Math.round(off.x + target.x);
  const y = Math.round(off.y + target.y);
  wc.sendInputEvent({ type: 'mouseMove', x, y });
  await sleep(60);
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  await sleep(50);
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  await sleep(180);
  onLog(`  클릭: ${target.sel} @ (${x},${y})`);
  return target.sel;
}

// 현재 캐럿(선택)이 제목 영역인지 본문 영역인지 판별한다.
async function selectionZone(frame) {
  return frame
    .executeJavaScript(`(() => {
      const sel = window.getSelection();
      let n = sel && sel.anchorNode;
      while (n) {
        if (n.classList) {
          if (n.classList.contains('se-documentTitle') || n.classList.contains('se-title-text')) return 'title';
          if (n.classList.contains('se-text')) return 'body';
        }
        n = n.parentElement;
      }
      return 'unknown';
    })()`)
    .catch(() => 'unknown');
}

// 선택자 후보 중 첫 매치를 클릭+포커스. 성공 여부 반환.
async function focusEditable(frame, selectors) {
  return frame.executeJavaScript(`(() => {
    const cands = ${JSON.stringify(selectors)};
    for (const s of cands) {
      const el = document.querySelector(s);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.click();
        el.focus();
        // contenteditable 안쪽 텍스트 노드로 캐럿 이동
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return s;
      }
    }
    return null;
  })()`).catch(() => null);
}

/**
 * 생성된 제목/본문을 SmartEditor 에 입력한다.
 * @param {{title:string, body:string, images?:string[], onLog?:Function}} opts
 *   images: 업로드 순서대로의 dataURL 배열. [IMGn] 은 images[n-1] 에 매핑.
 */
async function insertPost({ title, body, images = [], onLog = () => {} }) {
  const win = getLoginWindow();
  if (!win) throw new Error('로그인/글쓰기 창이 없습니다. 먼저 로그인하세요.');
  const wc = win.webContents;
  win.show();
  win.focus();

  // 글쓰기 페이지가 아니면 먼저 이동
  const cur = wc.getURL();
  if (!/blog\.naver\.com/.test(cur) || !/PostWrite|postwrite|Redirect=Write/i.test(cur)) {
    onLog('글쓰기 페이지가 아니라 먼저 이동합니다...');
    await openWritePage();
    await sleep(1500);
  }

  const frame = await findEditorFrame(wc, onLog);
  if (!frame) throw new Error('SmartEditor 프레임을 찾지 못했습니다. (로그 확인)');

  await dismissPopups(frame, onLog);
  await sleep(400);

  // 에디터 DOM 구조 진단 덤프
  await dumpEditorDom(frame, onLog);

  const mainFrame = wc.mainFrame;

  // ---- 제목 입력 (제목 모듈 .se-title-text 정확히 클릭) ----
  onLog('제목 클릭/입력 중...');
  const titleSel = await realClickInEditor(
    wc,
    mainFrame,
    frame,
    [
      '.se-title-text .se-text-paragraph',
      '.se-documentTitle .se-title-text .se-text-paragraph',
      '.se-title-text .se-placeholder',
    ],
    onLog
  );
  const titleZone = await selectionZone(frame);
  onLog(`제목 클릭 후 캐럿 위치: ${titleZone}`);
  if (titleSel && titleZone !== 'body') {
    await sleep(150);
    wc.insertText(title);
    await sleep(350);
  } else {
    onLog('제목 캐럿 확보 실패 — 제목 건너뜀(본문 오염 방지)');
  }

  // ---- 본문 입력 (본문 .se-component.se-text 만, 제목 제외) ----
  onLog('본문 클릭/입력 중...');
  let bodyZone = 'unknown';
  for (let attempt = 1; attempt <= 3; attempt++) {
    await realClickInEditor(
      wc,
      mainFrame,
      frame,
      [
        '.se-component.se-text .se-text-paragraph',
        '.se-content .se-component.se-text .se-text-paragraph',
        '.se-text.se-l-default .se-text-paragraph',
      ],
      onLog
    );
    bodyZone = await selectionZone(frame);
    onLog(`본문 클릭 후 캐럿 위치(시도 ${attempt}): ${bodyZone}`);
    if (bodyZone === 'body') break;
    await sleep(250);
  }
  // 캐럿이 본문이 아니면 본문 오염을 막기 위해 입력 중단.
  if (bodyZone !== 'body') {
    throw new Error('본문 입력란에 캐럿을 두지 못했습니다. (제목 오염 방지를 위해 중단)');
  }
  await sleep(150);

  const blocks = bodyToBlocks(body);
  let seq = 0; // 인덱스 없는 [IMG] 용 순차 카운터
  let inserted = 0;
  let missing = 0;
  const usedImages = new Set(); // 같은 사진 중복 삽입 방지
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'disclosure') {
      // 공정위 문구: 글 맨 위, 회색 작은 글씨 느낌으로 (HTML 붙여넣기)
      onLog('공정위 문구 삽입...');
      const html = `<span style="color:#888888;font-size:13px;">${escapeHtml(b.text)}</span>`;
      const ok = await pasteHtml(wc, html, b.text, onLog);
      if (!ok) wc.insertText(b.text);
      await sleep(350);
      sendEnter(wc);
      await resetFontColor(wc); // 회색이 본문까지 번지지 않게
      sendEnter(wc);
      await sleep(30);
    } else if (b.type === 'product') {
      // 상품 링크: 이름(굵게) 후 URL 붙여넣기 → 자동 링크/카드
      onLog(`상품 링크 삽입: ${b.name || b.url}`);
      if (b.name) {
        sendBold(wc);
        await sleep(20);
        wc.insertText(b.name);
        await sleep(20);
        sendBold(wc);
        sendEnter(wc);
        await sleep(20);
      }
      wc.insertText(b.url);
      sendEnter(wc); // URL 자동 링크 트리거
      await sleep(1600); // 링크 카드 생성 대기
      sendEnter(wc);
      await sleep(30);
    } else if (b.type === 'rating') {
      // 평점 이모지 줄: 굵게
      sendBold(wc);
      await sleep(30);
      wc.insertText(b.text);
      await sleep(30);
      sendBold(wc);
      sendEnter(wc);
      await sleep(30);
    } else if (b.type === 'review') {
      // 한줄평: 빨간색 굵게 (클립보드 HTML 붙여넣기)
      onLog('한줄평(빨강) 삽입...');
      const html = `<span style="color:#e74c3c;font-weight:bold;font-size:17px;">${escapeHtml(b.text)}</span>`;
      const ok = await pasteHtml(wc, html, b.text, onLog);
      if (!ok) {
        // 실패 시 일반 텍스트로라도 입력
        wc.insertText(b.text);
      }
      await sleep(400);
      sendEnter(wc);
      await resetFontColor(wc); // 빨간색이 본문까지 번지지 않게
      sendEnter(wc);
      await sleep(30);
    } else if (b.type === 'text') {
      if (b.heading) {
        // 소제목: 굵게 토글 ON → 입력 → 굵게 OFF, 뒤에 빈 줄 하나
        sendBold(wc);
        await sleep(40);
        wc.insertText(b.text);
        await sleep(40);
        sendBold(wc);
        sendEnter(wc);
        sendEnter(wc); // 제목 아래 여백
        await sleep(40);
      } else {
        wc.insertText(b.text);
        sendEnter(wc);
        await sleep(20); // 빠르게
      }
    } else if (b.type === 'blank') {
      sendEnter(wc);
      await sleep(15);
    } else if (b.type === 'img') {
      seq++;
      const idx = (b.index || seq) - 1; // [IMG3]→images[2], [IMG]→순차
      // 같은 사진이 이미 들어갔으면 중복 토큰이므로 건너뜀
      if (usedImages.has(idx)) {
        onLog(`사진 ${idx + 1} 중복 토큰 — 건너뜀`);
        continue;
      }
      usedImages.add(idx);
      const dataUrl = images[idx];
      if (dataUrl) {
        onLog(`사진 ${idx + 1} 붙여넣는 중...`);
        const ok = await pasteImage(wc, dataUrl, onLog);
        if (ok) inserted++;
        else missing++;
        await sleep(2200); // 네이버 서버 업로드 대기
        sendEnter(wc);
      } else {
        // 매핑되는 업로드 사진이 없으면 자리만 표시
        missing++;
        wc.insertText(`[사진 ${idx + 1} 없음]`);
        sendEnter(wc);
      }
      await sleep(20);
    }
  }

  onLog(`입력 완료 (사진 삽입 ${inserted}장, 누락 ${missing}곳)`);
  return { success: true, insertedImages: inserted, missingImages: missing };
}

// 이미지를 클립보드에 올린 뒤 Ctrl+V 로 현재 캐럿 위치에 붙여넣는다.
async function pasteImage(wc, dataUrl, onLog = () => {}) {
  try {
    let img = nativeImage.createFromDataURL(dataUrl);
    if (img.isEmpty()) {
      onLog('  (이미지 디코딩 실패)');
      return false;
    }
    // 안전장치: 너무 크면 한번 더 줄인다(네이버 용량초과 방지).
    const s = img.getSize();
    const MAX = 1600;
    if (s.width > MAX || s.height > MAX) {
      img = img.resize(s.width >= s.height ? { width: MAX } : { height: MAX });
    }
    clipboard.writeImage(img);
    await sleep(120);
    // Ctrl+V 는 keyDown/keyUp 만. char 이벤트를 보내면 붙여넣기가 두 번 트리거될 수 있음.
    wc.sendInputEvent({ type: 'keyDown', modifiers: ['control'], keyCode: 'V' });
    wc.sendInputEvent({ type: 'keyUp', modifiers: ['control'], keyCode: 'V' });
    return true;
  } catch (e) {
    onLog(`  (붙여넣기 오류: ${String(e).slice(0, 60)})`);
    return false;
  }
}

function sendEnter(wc) {
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  wc.sendInputEvent({ type: 'char', keyCode: '\r' });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// 색상 HTML 붙여넣기 후 캐럿 색이 다음 줄까지 번지는 것을 막는다.
// 검정 글자 하나를 넣었다 지워 캐럿 서식을 기본(검정)으로 되돌린다.
async function resetFontColor(wc) {
  await pasteHtml(wc, '<span style="color:#000000;font-weight:normal;">.</span>', '.');
  await sleep(220);
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
  await sleep(120);
}

// 서식 있는 HTML 을 클립보드에 올려 붙여넣는다(색상 등 적용).
async function pasteHtml(wc, html, text, onLog = () => {}) {
  try {
    clipboard.write({ text: text || '', html });
    await sleep(120);
    wc.sendInputEvent({ type: 'keyDown', modifiers: ['control'], keyCode: 'V' });
    wc.sendInputEvent({ type: 'keyUp', modifiers: ['control'], keyCode: 'V' });
    return true;
  } catch (e) {
    onLog('HTML 붙여넣기 오류: ' + String(e).slice(0, 60));
    return false;
  }
}

// 굵게(Bold) 토글 — Ctrl+B
function sendBold(wc) {
  wc.sendInputEvent({ type: 'keyDown', modifiers: ['control'], keyCode: 'B' });
  wc.sendInputEvent({ type: 'keyUp', modifiers: ['control'], keyCode: 'B' });
}

module.exports = { insertPost, findEditorFrame, dismissPopups, dismissEditorPopups };
