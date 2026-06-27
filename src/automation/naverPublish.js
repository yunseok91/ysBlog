'use strict';

// 네이버 SmartEditor "발행" 레이어 자동화:
//  - 카테고리 목록 불러오기
//  - 카테고리 선택 / 태그 입력 / 공개설정 / 최종 발행
//
// SmartEditor 의 발행 레이어는 해시된 CSS 클래스(예: publish_btn__xxxx)를 써서
// 클래스명이 자주 바뀐다. 그래서 "보이는 텍스트(발행/카테고리/태그)" 기반 탐색을
// 우선하고, 실패 시 진단용 DOM 덤프를 남겨 선택자를 보정한다.

const { getLoginWindow } = require('./naverLogin');
const { findEditorFrame, dismissPopups } = require('./naverEditor');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 발행 설정 레이어가 열렸는지: 카테고리 토글 버튼 존재로 판단(에디터 프레임).
async function isPublishLayerOpen(frame) {
  return frame
    .executeJavaScript(
      `(() => { const b = document.querySelector('button[aria-label="카테고리 목록 버튼"]'); return !!(b && b.offsetParent !== null); })()`
    )
    .catch(() => false);
}

// 발행 버튼(seOnePublishBtn)은 상단 툴바 프레임에 있을 수 있으므로 모든 프레임을 뒤진다.
async function clickInAnyFrame(wc, selector, onLog) {
  const frames = wc.mainFrame.framesInSubtree;
  for (const f of frames) {
    const clicked = await f
      .executeJavaScript(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) { el.click(); return true; } return false; })()`
      )
      .catch(() => false);
    if (clicked) {
      onLog(`클릭 성공 (frame: ${f.url.slice(0, 50)})`);
      return true;
    }
  }
  return false;
}

// 발행 설정 레이어를 연다(모든 프레임에서 발행 버튼 탐색). 열림을 검증해 반환한다.
async function openPublishLayer(wc, editorFrame, onLog) {
  if (await isPublishLayerOpen(editorFrame)) {
    onLog('발행 레이어: 이미 열림');
    return true;
  }
  // 레이어 '열기' 버튼: data-click-area="tpb.publish" (class publish_btn)
  const clicked = await clickInAnyFrame(
    wc,
    '[data-click-area="tpb.publish"], button[class*="publish_btn"]',
    onLog
  );
  onLog(`발행(열기) 버튼 클릭: ${clicked ? 'ok' : 'not-found'}`);
  await sleep(1400);
  const opened = await isPublishLayerOpen(editorFrame);
  onLog(`발행 설정 레이어 열림 확인: ${opened}`);
  return opened;
}

// 발행 레이어 안의 DOM 구조를 진단용으로 덤프한다(선택자 보정용).
async function dumpPublishDom(frame, onLog) {
  const info = await frame.executeJavaScript(`(() => {
    const pick = (els) => [...els].slice(0, 40).map((e) => ({
      tag: e.tagName.toLowerCase(),
      cls: (e.className || '').toString().slice(0, 60),
      txt: (e.innerText || e.value || '').trim().slice(0, 30),
    }));
    return {
      buttons: pick(document.querySelectorAll('button')),
      selects: pick(document.querySelectorAll('select, [role="combobox"], [class*="select"]')),
      inputs: pick(document.querySelectorAll('input')),
      categoryHints: pick(document.querySelectorAll('[class*="category" i], [class*="Category"]')),
    };
  })()`).catch((e) => ({ error: String(e) }));
  onLog('=== 발행 레이어 DOM 덤프 ===');
  onLog(JSON.stringify(info, null, 2));
  return info;
}

// 카테고리 토글 버튼을 연다.
const CAT_TOGGLE =
  'button[aria-label="카테고리 목록 버튼"], [data-click-area*="category"], button[class*="selectbox_button"]';

// 카테고리 목록을 읽어온다. 드롭다운을 열어 항목 텍스트를 수집.
async function scrapeCategories(frame, onLog) {
  const cats = await frame.executeJavaScript(`(() => {
    const toggle = document.querySelector(${JSON.stringify(CAT_TOGGLE)});
    if (toggle) toggle.click();
    return new Promise((resolve) => setTimeout(() => {
      // 카테고리 항목: data-testid="categoryItemText_N" 패턴 우선
      let nodes = [...document.querySelectorAll('[data-testid^="categoryItemText"]')];
      if (!nodes.length) {
        nodes = [...document.querySelectorAll('[role="menu"] [role="menuitem"], [role="menuitemradio"], [class*="option_category" i] [class*="text" i]')];
      }
      const texts = nodes.map((n) => (n.innerText || '').trim()).filter((t) => t && t.length <= 40);
      resolve([...new Set(texts)]);
    }, 700));
  })()`).catch((e) => {
    onLog('카테고리 스크랩 오류: ' + e);
    return [];
  });
  onLog(`카테고리 ${cats.length}개 수집: ${cats.join(' | ')}`);
  return cats;
}

// 카테고리 목록을 불러온다(발행 레이어 열기 → 스크랩 → 덤프).
async function loadCategories({ onLog = () => {} } = {}) {
  const win = getLoginWindow();
  if (!win) throw new Error('로그인/글쓰기 창이 없습니다. 먼저 로그인하세요.');
  const wc = win.webContents;
  win.show();
  win.focus();

  const frame = await findEditorFrame(wc, onLog);
  if (!frame) throw new Error('SmartEditor 프레임을 찾지 못했습니다.');

  // 작성 중 글 팝업 등이 떠 있으면 먼저 닫는다.
  await dismissPopups(frame, onLog);
  await sleep(400);

  const opened = await openPublishLayer(wc, frame, onLog);
  if (!opened) {
    await dumpPublishDom(frame, onLog);
    throw new Error('발행 설정 레이어를 열지 못했습니다. (로그의 DOM 덤프 확인)');
  }
  const cats = await scrapeCategories(frame, onLog);
  if (!cats.length) await dumpPublishDom(frame, onLog);
  return { categories: cats };
}

// 텍스트로 카테고리를 선택한다(토글 열고 항목 클릭).
async function selectCategory(frame, category, onLog) {
  if (!category) return false;
  const ok = await frame.executeJavaScript(`(() => {
    const target = ${JSON.stringify(category)};
    const toggle = document.querySelector(${JSON.stringify(CAT_TOGGLE)});
    if (toggle) toggle.click();
    return new Promise((res) => setTimeout(() => {
      const items = [...document.querySelectorAll('[data-testid^="categoryItemText"], [role="menuitem"], [role="menuitemradio"]')];
      const hit = items.find((el) => (el.innerText || '').trim() === target);
      if (hit) {
        const clickable = hit.closest('button, [role="menuitem"], [role="menuitemradio"], li, a') || hit;
        clickable.click();
        res(true);
      } else res(false);
    }, 500));
  })()`).catch(() => false);
  onLog(`카테고리 선택(${category}): ${ok ? '성공' : '실패'}`);
  return ok;
}

// 태그를 입력한다.
async function inputTags(frame, wc, tags, onLog) {
  if (!tags || !tags.length) return 0;
  const focused = await frame.executeJavaScript(`(() => {
    const inp = document.querySelector('input[class*="tag" i], input[placeholder*="태그"], [class*="tag" i] input');
    if (inp) { inp.focus(); inp.click(); return true; }
    return false;
  })()`).catch(() => false);
  if (!focused) {
    onLog('태그 입력란을 찾지 못함');
    return 0;
  }
  let count = 0;
  for (const tag of tags) {
    wc.insertText(tag);
    await sleep(120);
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await sleep(150);
    count++;
  }
  onLog(`태그 ${count}개 입력`);
  return count;
}

// 공개설정 라디오 선택(전체공개/이웃공개/서로이웃공개/비공개).
async function setVisibility(frame, visibility, onLog) {
  if (!visibility) return false;
  const ok = await frame.executeJavaScript(`(() => {
    const target = ${JSON.stringify(visibility)};
    const labels = [...document.querySelectorAll('label, span, button')];
    const hit = labels.find((el) => (el.innerText || '').trim() === target);
    if (hit) { hit.click(); return true; }
    return false;
  })()`).catch(() => false);
  onLog(`공개설정(${visibility}): ${ok ? '성공' : '실패'}`);
  return ok;
}

// 최종 발행(확정) 버튼: data-testid="seOnePublishBtn" / data-click-area="tpb*i.publish"
async function clickFinalPublish(wc, onLog) {
  const clicked = await clickInAnyFrame(
    wc,
    'button[data-testid="seOnePublishBtn"], [data-click-area="tpb*i.publish"]',
    onLog
  );
  onLog(`최종 발행 클릭: ${clicked ? '성공' : '실패'}`);
  return clicked;
}

/**
 * 발행을 수행한다.
 * @param {{category?:string, tags?:string[], visibility?:string, publish?:boolean, onLog?:Function}} o
 */
async function publish({ category, tags = [], visibility = '전체공개', publish: doPublish = false, onLog = () => {} } = {}) {
  const win = getLoginWindow();
  if (!win) throw new Error('로그인/글쓰기 창이 없습니다.');
  const wc = win.webContents;
  win.show();
  win.focus();

  const frame = await findEditorFrame(wc, onLog);
  if (!frame) throw new Error('SmartEditor 프레임을 찾지 못했습니다.');

  await dismissPopups(frame, onLog);
  await sleep(400);

  const opened = await openPublishLayer(wc, frame, onLog);
  if (!opened) {
    await dumpPublishDom(frame, onLog);
    throw new Error('발행 설정 레이어를 열지 못했습니다. (로그의 DOM 덤프 확인)');
  }
  await sleep(500);

  const result = { category: false, tags: 0, visibility: false, published: false };
  result.category = await selectCategory(frame, category, onLog);
  result.visibility = await setVisibility(frame, visibility, onLog);
  result.tags = await inputTags(frame, wc, tags, onLog);

  if (doPublish) {
    await sleep(400);
    result.published = await clickFinalPublish(wc, onLog);
  } else {
    onLog('발행 직전까지 세팅 완료. 화면에서 확인 후 직접 발행하세요.');
  }
  return result;
}

module.exports = { loadCategories, publish };
