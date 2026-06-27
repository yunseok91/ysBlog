'use strict';

const fs = require('fs');
const path = require('path');

// .env 를 직접 파싱한다(외부 의존성 없이).
// 지원 형식:
//   OPENAI_API_KEY=sk-...
//   OPENAI_MODEL=gpt-4o
//   NAVER_BLOG_ID=ys_note91
// 그리고 변수명 없이 키 값만 한 줄로 적힌 경우(sk-... 단독)도 허용한다.
function loadEnv(rootDir) {
  const file = path.join(rootDir, '.env');
  const out = { apiKey: '', model: '', blogId: '' };

  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (_) {
    return out; // .env 없음
  }

  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim().toUpperCase();
      let val = trimmed.slice(eq + 1).trim();
      // 따옴표 제거
      val = val.replace(/^["']|["']$/g, '');
      if (key === 'OPENAI_API_KEY' || key === 'GPT_API_KEY') out.apiKey = val;
      else if (key === 'OPENAI_MODEL') out.model = val;
      else if (key === 'NAVER_BLOG_ID') out.blogId = val;
    } else if (/^sk-[A-Za-z0-9_\-]+$/.test(trimmed)) {
      // 변수명 없이 키만 적힌 줄
      out.apiKey = trimmed;
    }
  }

  if (!out.model) out.model = 'gpt-4o';
  if (!out.blogId) out.blogId = 'ys_note91';
  return out;
}

module.exports = { loadEnv };
