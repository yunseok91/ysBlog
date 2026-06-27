'use strict';

const $ = (id) => document.getElementById(id);

// ----- 탭 전환 -----
function activateTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
}

document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn || btn.disabled) return;
  activateTab(btn.dataset.tab);
});

// ----- 상태/로그 출력 -----
const statusDot = $('statusDot');
const statusText = $('statusText');
const logEl = $('log');

function setStatus(kind, text) {
  statusDot.className = `status-dot ${kind}`;
  statusText.textContent = text;
}

function addLog(text, cls = '') {
  logEl.classList.add('show');
  const line = document.createElement('div');
  if (cls) line.className = cls;
  const time = new Date().toLocaleTimeString('ko-KR');
  line.textContent = `[${time}] ${text}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

// 진행 상태 스트림 구독
window.api.onLoginStatus(({ stage, msg }) => {
  const kind = stage === 'done' ? 'ok' : stage === 'error' ? 'err' : 'busy';
  setStatus(kind, msg);
  addLog(msg, stage === 'done' ? 'ok' : stage === 'error' ? 'err' : '');
});

// ----- 비밀번호 표시/숨김 -----
$('togglePw').addEventListener('click', () => {
  const pw = $('naverPw');
  pw.type = pw.type === 'password' ? 'text' : 'password';
});

// ----- 저장된 계정 로드 -----
async function refreshAccounts() {
  const accounts = await window.api.listAccounts();
  const sel = $('savedAccounts');
  sel.innerHTML = '<option value="">— 직접 입력 —</option>';
  accounts.forEach((a) => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.encrypted ? a.id : `${a.id} (평문저장)`;
    sel.appendChild(opt);
  });
}

$('savedAccounts').addEventListener('change', async (e) => {
  const id = e.target.value;
  if (!id) {
    $('naverId').value = '';
    $('naverPw').value = '';
    return;
  }
  const acc = await window.api.getAccount(id);
  if (acc) {
    $('naverId').value = acc.id;
    $('naverPw').value = acc.pw;
    $('saveCreds').checked = true;
  }
});

$('deleteAccountBtn').addEventListener('click', async () => {
  const id = $('savedAccounts').value;
  if (!id) return;
  await window.api.deleteAccount(id);
  await refreshAccounts();
  addLog(`저장된 계정 삭제: ${id}`);
});

// 로그인됨 상태 표시 (탭에 초록 점 + 패널 상태 + 버튼 텍스트)
function markLoggedIn(id) {
  const loginTab = document.querySelector('.tab[data-tab="login"]');
  if (loginTab) loginTab.classList.add('logged-in');
  setStatus('ok', `로그인됨 — ${id}`);
  $('loginBtn').textContent = '✓ 로그인됨 (다시 로그인하려면 클릭)';
}

// ----- 로그인 실행 -----
$('loginBtn').addEventListener('click', async () => {
  const id = $('naverId').value.trim();
  const pw = $('naverPw').value;
  if (!id || !pw) {
    setStatus('err', '아이디와 비밀번호를 입력하세요.');
    return;
  }

  const btn = $('loginBtn');
  btn.disabled = true;
  btn.textContent = '로그인 중...';
  setStatus('busy', '로그인 시작...');
  addLog('로그인 시작');

  try {
    const result = await window.api.login({
      id,
      pw,
      save: $('saveCreds').checked,
      show: $('showBrowser').checked,
    });

    if (result.success) {
      setStatus('ok', result.message || '로그인 성공');
      addLog(result.message || '로그인 성공', 'ok');
      if ($('saveCreds').checked) await refreshAccounts();
      // 로그인됨 표시 + 글쓰기 탭으로 자동 이동 (버튼 텍스트는 markLoggedIn 이 설정)
      markLoggedIn(id);
      activateTab('write');
    } else {
      setStatus('err', result.message || '로그인 실패');
      addLog(result.message || '로그인 실패', 'err');
      btn.textContent = '로그인 실행';
    }
  } catch (err) {
    setStatus('err', err.message || String(err));
    addLog(err.message || String(err), 'err');
    btn.textContent = '로그인 실행';
  } finally {
    btn.disabled = false;
  }
});

// ===================== 글쓰기 탭 =====================
const uploadedImages = []; // {src, name, caption} 배열
let loadedCategories = []; // 불러온 블로그 카테고리
let selectedRating = 0; // 별점 (0=선택 안 함, 1~5)

// 별점 UI
function renderStars() {
  document.querySelectorAll('#rating .star').forEach((s) => {
    s.classList.toggle('on', Number(s.dataset.v) <= selectedRating);
  });
  $('ratingLabel').textContent = selectedRating ? `${selectedRating}점 / 5점` : '선택 안 함';
}
$('rating').addEventListener('click', (e) => {
  const star = e.target.closest('.star');
  if (!star) return;
  const v = Number(star.dataset.v);
  selectedRating = selectedRating === v ? 0 : v; // 같은 별 다시 누르면 해제
  renderStars();
});

// GPT 키 로드 상태 표시
async function refreshAiStatus() {
  const badge = $('aiBadge');
  try {
    const s = await window.api.aiStatus();
    if (s.hasKey) {
      badge.className = 'ai-badge ok';
      badge.textContent = `GPT 키 로드됨 · 모델 ${s.model} · 블로그 ${s.blogId}`;
    } else {
      badge.className = 'ai-badge err';
      badge.textContent = '.env 에서 GPT 키를 찾지 못했습니다. OPENAI_API_KEY 를 확인하세요.';
    }
  } catch (_) {
    badge.className = 'ai-badge err';
    badge.textContent = '키 상태 확인 실패';
  }
}

// 업로드 이미지를 적정 크기로 줄이고 EXIF 회전을 보정해 JPEG dataURL 로 변환.
// (네이버 용량초과 방지 + GPT 비전 비용 절감 + 사진 방향 정상화)
async function fileToResizedDataURL(file, maxDim = 1600, quality = 0.85) {
  // createImageBitmap 의 imageOrientation 으로 EXIF 회전까지 적용
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  let { width, height } = bitmap;
  if (width > maxDim || height > maxDim) {
    const scale = Math.min(maxDim / width, maxDim / height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', quality);
}

// 이미지 업로드 → 리사이즈 (업로드 순서 유지)
$('imgInput').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  setGenStatus('busy', `이미지 ${files.length}장 처리(리사이즈) 중...`);
  // Promise.all 은 배열 순서를 보존하므로 업로드 순서가 유지됨
  const results = await Promise.all(
    files.map((f) =>
      fileToResizedDataURL(f)
        .then((src) => ({ src, name: f.name, caption: '' }))
        .catch((err) => {
          console.error('이미지 처리 실패:', f.name, err);
          return null;
        })
    )
  );
  results.filter(Boolean).forEach((it) => uploadedImages.push(it));
  renderThumbs();
  renderPreview();
  setGenStatus('ok', `이미지 ${uploadedImages.length}장 준비됨 (리사이즈/회전보정 완료)`);
  e.target.value = ''; // 같은 파일 재선택 허용
});

// 번호 배지 + 삭제 + 사진별 설명 입력란이 달린 썸네일 렌더
function renderThumbs() {
  const thumbs = $('thumbs');
  thumbs.innerHTML = '';
  uploadedImages.forEach((it, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'thumb';

    const badge = document.createElement('span');
    badge.className = 'num';
    badge.textContent = i + 1;
    const del = document.createElement('button');
    del.className = 'del';
    del.dataset.i = i;
    del.title = '삭제';
    del.textContent = '×';
    const img = document.createElement('img');
    img.src = it.src;
    img.title = it.name || `사진 ${i + 1}`;

    // 사진 설명 입력란 (GPT가 위치/맥락 판단에 활용)
    const cap = document.createElement('input');
    cap.className = 'cap';
    cap.type = 'text';
    cap.placeholder = '사진 설명 (예: 정상 표지석)';
    cap.value = it.caption || '';
    cap.addEventListener('input', () => {
      uploadedImages[i].caption = cap.value;
    });

    wrap.appendChild(badge);
    wrap.appendChild(del);
    wrap.appendChild(img);
    wrap.appendChild(cap);
    thumbs.appendChild(wrap);
  });
}

// 썸네일 삭제(인덱스가 당겨지므로 미리보기도 갱신)
$('thumbs').addEventListener('click', (e) => {
  const btn = e.target.closest('.del');
  if (!btn) return;
  uploadedImages.splice(Number(btn.dataset.i), 1);
  renderThumbs();
  renderPreview();
});

// 상품 링크 입력을 [{name, url}] 로 파싱 ("상품명 | URL" 또는 "URL").
function parseProducts(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.split('|').map((s) => s.trim());
      if (parts.length >= 2) return { name: parts[0], url: parts.slice(1).join('|') };
      return { name: '', url: parts[0] };
    })
    .filter((p) => /^https?:\/\//.test(p.url));
}

// 본문 + 업로드 사진으로 미리보기를 그린다([IMGn] 자리에 실제 썸네일 표시).
function renderPreview() {
  const preview = $('preview');
  const body = $('resultBody').value;
  if (!body.trim()) {
    preview.innerHTML = '<span class="pv-empty">본문이 생성되면 여기서 사진 위치를 확인할 수 있습니다.</span>';
    return;
  }
  preview.innerHTML = '';
  const parts = body.split(/(\[IMG\d+\])/g);
  for (const part of parts) {
    const m = part.match(/^\[IMG(\d+)\]$/);
    if (m) {
      const idx = parseInt(m[1], 10);
      const item = uploadedImages[idx - 1];
      const wrap = document.createElement('div');
      if (item) {
        wrap.className = 'pv-img';
        const img = document.createElement('img');
        img.src = item.src;
        wrap.appendChild(img);
        const tag = document.createElement('span');
        tag.className = 'pv-tag';
        tag.textContent = `사진 ${idx}`;
        wrap.appendChild(tag);
      } else {
        wrap.className = 'pv-img missing';
        wrap.textContent = `[IMG${idx}] — 업로드된 ${idx}번 사진이 없습니다`;
      }
      preview.appendChild(wrap);
    } else if (part.trim()) {
      // 줄 단위로 헤딩/평점/한줄평 판단
      for (const line of part.split('\n')) {
        if (!line.trim()) continue;
        const div = document.createElement('div');
        const rating = line.match(/^\[RATING\]\s*(.*)/i);
        const review = line.match(/^\[REVIEW\]\s*(.*)/i);
        const disclosure = line.match(/^\[DISCLOSURE\]\s*(.*)/i);
        const product = line.match(/^\[PRODUCT\]\s*(.*)/i);
        const h2 = line.match(/^\s*##\s+(.*)/);
        const h3 = line.match(/^\s*###\s+(.*)/);
        if (disclosure) {
          div.className = 'pv-disclosure';
          div.textContent = '📢 ' + disclosure[1];
        } else if (product) {
          const parts = product[1].split('|');
          div.className = 'pv-product';
          div.textContent = '🔗 ' + (parts.length >= 2 ? `${parts[0].trim()} — ${parts[1].trim()}` : parts[0].trim());
        } else if (rating) {
          div.className = 'pv-rating';
          div.textContent = rating[1];
        } else if (review) {
          div.className = 'pv-review';
          div.textContent = review[1];
        } else if (h3) {
          div.className = 'pv-text h3';
          div.textContent = h3[1];
        } else if (h2) {
          div.className = 'pv-text h2';
          div.textContent = h2[1];
        } else {
          div.className = 'pv-text';
          div.textContent = line.replace(/\*\*(.+?)\*\*/g, '$1');
        }
        preview.appendChild(div);
      }
    }
  }
}

// 본문을 손으로 고치면 미리보기 실시간 갱신
$('resultBody').addEventListener('input', renderPreview);

function setGenStatus(kind, text) {
  $('genDot').className = `status-dot ${kind}`;
  $('genText').textContent = text;
}

// GPT 글 생성
$('genBtn').addEventListener('click', async () => {
  const keyword = $('kw').value.trim();
  if (!keyword) {
    setGenStatus('err', '핵심 키워드/주제를 입력하세요.');
    return;
  }
  const btn = $('genBtn');
  btn.disabled = true;
  btn.textContent = '생성 중...';
  setGenStatus('busy', `GPT 글 생성 중... (이미지 ${uploadedImages.length}장)`);

  try {
    const res = await window.api.generatePost({
      keyword,
      experience: $('exp').value.trim(),
      prompt: $('prompt').value.trim(),
      images: uploadedImages.map((it) => it.src),
      captions: uploadedImages.map((it) => it.caption || ''),
      categories: loadedCategories,
      rating: selectedRating,
      ratingReason: $('ratingReason').value.trim(),
    });
    if (res.success) {
      $('resultTitle').value = res.title || '';
      // 맨 위: 공정위 문구 → 평점(이모지) → 한줄평(빨강)
      const head = [];
      if ($('connectEnabled').checked) {
        head.push('[DISCLOSURE]이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로 판매 발생 시 수수료를 제공받습니다.');
      }
      if (selectedRating > 0) {
        const stars = '⭐'.repeat(selectedRating) + '☆'.repeat(5 - selectedRating);
        head.push(`[RATING]${stars} (${selectedRating}/5)`);
      }
      if (res.oneline) head.push(`[REVIEW]${res.oneline}`);
      // 맨 아래: 상품 링크 섹션
      const products = parseProducts($('products').value);
      let tail = '';
      if (products.length) {
        tail = '\n\n## 관련 상품\n' + products.map((p) => `[PRODUCT]${p.name}|${p.url}`).join('\n');
      }
      $('resultBody').value =
        (head.length ? head.join('\n') + '\n\n' : '') + (res.body || '') + tail;
      renderPreview();
      // 태그 자동 채움
      if (res.tags && res.tags.length) $('tagsInput').value = res.tags.join(', ');
      // GPT 추천 카테고리 미리 선택
      if (res.category) selectCategoryOption(res.category);
      // 글자수(사진 토큰 제외, 공백 포함) 계산
      const charCount = (res.body || '').replace(/\[IMG\d+\]/g, '').replace(/\s/g, '').length;
      const tok = res.usage ? ` · 토큰 ${res.usage.total_tokens}` : '';
      const imgInfo = res.imageTokens != null ? ` · 사진자리 ${res.imageTokens}개` : '';
      const catInfo = res.category ? ` · 추천 "${res.category}"` : '';
      setGenStatus('ok', `생성 완료 · 본문 ${charCount}자${imgInfo}${catInfo}${tok}`);
    } else {
      setGenStatus('err', res.message || '생성 실패');
    }
  } catch (err) {
    setGenStatus('err', err.message || String(err));
  } finally {
    btn.disabled = false;
    btn.textContent = 'GPT로 글 생성';
  }
});

// 복사 (제목 + 본문)
$('copyBtn').addEventListener('click', async () => {
  const title = $('resultTitle').value;
  const body = $('resultBody').value;
  if (!title && !body) return;
  await navigator.clipboard.writeText(`${title}\n\n${body}`);
  setGenStatus('ok', '제목+본문 클립보드에 복사됨');
});

// 네이버 글쓰기 페이지 열기(로그인 세션 유지)
$('openWriteBtn').addEventListener('click', async () => {
  setGenStatus('busy', '글쓰기 페이지 여는 중...');
  const r = await window.api.openWritePage();
  if (r && r.error) setGenStatus('err', r.error);
  else setGenStatus('ok', '글쓰기 페이지를 열었습니다.');
});

// 에디터 입력 진행 상태 로그
window.api.onInsertStatus(({ msg }) => {
  setGenStatus('busy', msg);
});

// 에디터에 글 입력(키입력)
$('insertBtn').addEventListener('click', async () => {
  const title = $('resultTitle').value.trim();
  const body = $('resultBody').value;
  if (!title && !body) {
    setGenStatus('err', '먼저 글을 생성하거나 제목/본문을 입력하세요.');
    return;
  }
  const btn = $('insertBtn');
  btn.disabled = true;
  btn.textContent = '입력 중...';
  setGenStatus('busy', '에디터에 입력 시작...');
  try {
    const r = await window.api.insertPost({
      title,
      body,
      images: uploadedImages.map((it) => it.src),
    });
    if (r.success) {
      setGenStatus('ok', `입력 완료 (사진 ${r.insertedImages || 0}장, 누락 ${r.missingImages || 0}곳)`);
    } else {
      setGenStatus('err', r.message || '입력 실패');
    }
  } catch (err) {
    setGenStatus('err', err.message || String(err));
  } finally {
    btn.disabled = false;
    btn.textContent = '📝 에디터에 글 입력';
  }
});

// ---- 카테고리 / 발행 ----
function fillCategoryOptions(cats) {
  const sel = $('categorySel');
  sel.innerHTML = '<option value="">— 카테고리 선택 —</option>';
  cats.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  });
}

function selectCategoryOption(cat) {
  const sel = $('categorySel');
  // 정확 일치가 있으면 선택, 없으면 옵션 추가 후 선택
  let found = [...sel.options].find((o) => o.value === cat);
  if (!found) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat + ' (추천)';
    sel.appendChild(opt);
  }
  sel.value = cat;
}

// 발행 진행 상태 로그
window.api.onPublishStatus(({ msg }) => setGenStatus('busy', msg));

// 카테고리 불러오기
$('loadCatBtn').addEventListener('click', async () => {
  setGenStatus('busy', '카테고리 불러오는 중... (글쓰기 페이지/발행 레이어 필요)');
  const r = await window.api.loadCategories();
  if (r.success && r.categories.length) {
    loadedCategories = r.categories;
    fillCategoryOptions(loadedCategories);
    setGenStatus('ok', `카테고리 ${loadedCategories.length}개 불러옴`);
  } else {
    setGenStatus('err', r.message || '카테고리를 불러오지 못했습니다 (로그 확인).');
  }
});

// 발행 성공 후 글쓰기 폼 초기화 (카테고리/공개설정은 같은 블로그라 유지)
function resetWriteForm() {
  $('kw').value = '';
  $('exp').value = '';
  $('prompt').value = '';
  $('resultTitle').value = '';
  $('resultBody').value = '';
  $('tagsInput').value = '';
  $('ratingReason').value = '';
  $('products').value = '';
  $('connectEnabled').checked = false;
  selectedRating = 0;
  renderStars();
  uploadedImages.length = 0;
  renderThumbs();
  renderPreview();
}

// 발행 설정 적용 / 발행
$('publishBtn').addEventListener('click', async () => {
  const category = $('categorySel').value;
  const tags = $('tagsInput').value.split(',').map((t) => t.trim()).filter(Boolean);
  const visibility = $('visibilitySel').value;
  const publish = $('autoPublish').checked;

  const btn = $('publishBtn');
  btn.disabled = true;
  btn.textContent = '처리 중...';
  setGenStatus('busy', publish ? '발행 설정 후 게시 중...' : '발행 직전까지 세팅 중...');
  try {
    const r = await window.api.publish({ category, tags, visibility, publish });
    if (r.success) {
      const msg = publish
        ? r.published ? '🚀 발행 완료! 새 글 작성 준비됨' : '설정은 됐지만 발행 버튼 클릭 실패 (직접 발행하세요)'
        : '발행 직전까지 세팅 완료. 화면에서 확인 후 발행하세요.';
      setGenStatus(r.published || !publish ? 'ok' : 'err', msg);
      // 발행 성공 시 폼 초기화 + 다음 글용 새 에디터 열기
      if (r.published) {
        resetWriteForm();
        await window.api.openWritePage();
      }
    } else {
      setGenStatus('err', r.message || '발행 실패');
    }
  } catch (err) {
    setGenStatus('err', err.message || String(err));
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 발행 설정 적용 / 발행하기';
  }
});

// 초기화
refreshAccounts();
refreshAiStatus();
renderStars();
