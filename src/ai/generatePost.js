'use strict';

const fs = require('fs');
const path = require('path');

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

// blog.md 를 시스템 프롬프트(작성 규칙)로 읽어온다.
function loadSystemPrompt(rootDir) {
  try {
    return fs.readFileSync(path.join(rootDir, 'blog.md'), 'utf8');
  } catch (_) {
    return '너는 네이버 블로그 SEO 전문가다. 구조화된 양질의 글을 작성하라.';
  }
}

// blog.md 의 Input Data 형식에 맞춰 사용자 메시지 본문을 구성한다.
function buildUserText({ keyword, experience, prompt, imageCount = 0, categories = [], captions = [], rating = 0, ratingReason = '' }) {
  const parts = [];
  parts.push('# Input Data');
  parts.push(`- 핵심 키워드/주제: ${keyword || '(미입력)'}`);
  parts.push(
    `- 사용자 실제 경험 데이터 (필수 반영): ${experience || '(미입력)'}`
  );
  // 별점(평점)이 있으면 글 전체 논조에 반영하도록 지시.
  if (rating > 0) {
    const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
    parts.push(`- 작성자 평점: ${rating}/5점 (${stars})`);
    if (ratingReason) parts.push(`- 평점 이유: ${ratingReason}`);
    parts.push(
      `이 평점과 이유가 글 전체의 논조와 [ONELINE] 한줄평에 자연스럽게 반영돼야 한다. ` +
        `점수가 높으면(4~5점) 진심 추천 톤, 보통이면(3점) 장단점을 솔직히 섞은 톤, ` +
        `낮으면(1~2점) 아쉬움을 솔직하게 짚는 톤. 무조건적 찬양/비방이 아니라 근거(평점 이유)를 녹여 균형 있게 써라.`
    );
  }
  if (prompt && prompt.trim()) {
    parts.push('');
    parts.push('# 추가 지시사항');
    parts.push(prompt.trim());
  }
  parts.push('');
  // 사진 개수/설명에 맞춰 [IMGn] 토큰 배치 규칙을 명시한다.
  const hasCaptions = captions.some((c) => c && c.trim());
  if (imageCount > 0) {
    if (hasCaptions) {
      // 사진별 설명이 있으면, 번호를 맥락에 맞게 의도적으로 배치하게 한다.
      parts.push(`사용자가 사진 ${imageCount}장을 업로드했다. 각 사진의 설명은 다음과 같다:`);
      for (let i = 0; i < imageCount; i++) {
        const c = (captions[i] || '').trim();
        parts.push(`- 사진${i + 1}: ${c || '(설명 없음)'}`);
      }
      parts.push(
        `각 사진을 그 설명과 첨부 이미지를 함께 보고, 본문에서 그 사진이 등장하기 가장 자연스러운 위치(시간/논리 순서)에 ` +
          `[IMG번호] 토큰을 단독 줄로 넣어라. 예: 정상 사진이 3번이면 정상 장면 문단 뒤에 [IMG3]. ` +
          `번호는 위 사진 번호와 반드시 일치해야 하며(순서를 바꿔 배치해도 됨), ${imageCount}장 모두 한 번씩 사용하라. ` +
          `토큰을 한곳에 몰지 말고 글 흐름에 맞게 분산하라.`
      );
    } else {
      parts.push(
        `사용자가 사진 ${imageCount}장을 업로드했다(첨부 순서대로). ` +
          `각 사진을 분석해 실제 본 것처럼 본문에 녹이고, 본문 흐름상 가장 자연스러운 위치에 ` +
          `정확히 ${imageCount}개의 [IMG] 토큰을 다른 텍스트 없이 단독 줄로 1개씩 배치하라. ` +
          `토큰 개수는 반드시 ${imageCount}개여야 하며, 한곳에 몰지 말고 글 전체에 고르게 분산하라.`
      );
    }
  } else {
    parts.push('업로드된 사진이 없으므로 [IMG] 토큰을 넣지 마라.');
  }
  parts.push(
    'blog.md 의 "사람처럼 쓰는 규칙"을 최우선으로 지켜라. ' +
      '특히 (H2)(H3) 같은 메타 라벨, "목차", 기계적 번호 소제목은 절대 출력하지 마라. ' +
      '주어진 경험 데이터를 글 곳곳에 1인칭으로 풀어내 진짜 후기처럼 써라.'
  );
  parts.push('');
  parts.push(
    'blog.md 의 "출력 형식(Output Format)" 을 따르되, 아래 라벨 순서로 출력하라. ' +
      '여는말/맺음말 없이 라벨만 사용하라.'
  );
  parts.push('[TITLE] 줄 아래: 제목 한 줄');
  parts.push(
    '[ONELINE] 줄 아래: 글 맨 위에 빨간색으로 강조될 강렬한 한줄평 한 문장(20~45자). 평점을 한 문장으로 요약하되 과장/낚시는 금지.'
  );
  parts.push(
    '[BODY] 줄 아래: 본문 전체(마크다운). 분량은 반드시 한글 1,800~2,700자(서론 300~500 / 본론 1,400~1,800 / 결론 400~600)로 충분히 채워라. 너무 짧으면 실패다.'
  );
  parts.push(
    '[TAGS] 줄 아래: 네이버 블로그 태그 5~8개를 콤마(,)로 구분해 한 줄로. # 기호 없이 단어만.'
  );
  if (categories.length) {
    parts.push(
      `[CATEGORY] 줄 아래: 아래 카테고리 목록 중 이 글에 가장 어울리는 것 "하나만" 정확히 그대로 적어라.\n` +
        `사용 가능한 카테고리: ${categories.join(' | ')}`
    );
  }
  return parts.join('\n');
}

// 혹시 모델이 양식 라벨을 흘렸을 때를 대비한 후처리 정리.
function sanitize(s) {
  if (!s) return s;
  return s
    // 제목/소제목 끝에 붙은 (H1)/(H2)/(H3) 라벨 제거
    .replace(/\s*\((?:H[1-6])\)\s*/gi, ' ')
    // "## 1. 제목" 식의 기계적 번호는 두되, "목차:" 줄은 제거
    .replace(/^\s*목차\s*[:：].*$/gim, '')
    .replace(/^\s*\[\s*목차[^\]]*\]\s*$/gim, '')
    // [도입부...], [내용 기술...] 같은 메타 대괄호 줄 제거
    .replace(/^\s*\[\s*(도입부|내용\s*기술|링크[^\]]*)\]\s*$/gim, '')
    // [이미지: 설명] → [IMG] 토큰으로 정규화
    .replace(/\[\s*이미지\s*[:：][^\]]*\]/gi, '[IMG]')
    // 3줄 이상 연속 빈 줄을 2줄로 축소
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// [TITLE]/[BODY]/[TAGS]/[CATEGORY] 라벨 사이 내용을 위치 기반으로 잘라낸다.
function extractSections(raw) {
  const labels = ['TITLE', 'BODY', 'TAGS', 'CATEGORY', 'ONELINE'];
  const found = [];
  for (const l of labels) {
    const m = raw.match(new RegExp('\\[\\s*' + l + '\\s*\\]', 'i'));
    if (m) found.push({ label: l.toLowerCase(), start: m.index, len: m[0].length });
  }
  found.sort((a, b) => a.start - b.start);
  const out = {};
  for (let i = 0; i < found.length; i++) {
    const cur = found[i];
    const next = found[i + 1];
    const end = next ? next.start : raw.length;
    out[cur.label] = raw.slice(cur.start + cur.len, end).trim();
  }
  return out;
}

// 태그 문자열을 배열로. "#" 제거, 콤마/공백 구분.
function parseTags(s) {
  if (!s) return [];
  return s
    .replace(/\n/g, ',')
    .split(/[,、]/)
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean)
    .slice(0, 10);
}

// 모델 응답에서 제목/본문/태그/카테고리를 추출한다.
function parseResult(text) {
  let raw = text.trim();
  const fence = raw.match(/```(?:json|markdown)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();

  // 1) 라벨 형식
  const sec = extractSections(raw);
  if (sec.title || sec.body) {
    return {
      title: sanitize(sec.title || '').replace(/^제목\s*[:：]\s*/, ''),
      body: sanitize(sec.body || ''),
      tags: parseTags(sec.tags),
      category: (sec.category || '').split('\n')[0].trim(),
      oneline: (sec.oneline || '').split('\n')[0].trim(),
    };
  }

  // 2) JSON 폴백
  try {
    const obj = JSON.parse(raw);
    if (obj && (obj.title || obj.body)) {
      return {
        title: sanitize((obj.title || '').trim()).replace(/^제목\s*[:：]\s*/, ''),
        body: sanitize((obj.body || '').trim()),
        tags: parseTags(Array.isArray(obj.tags) ? obj.tags.join(',') : obj.tags),
        category: (obj.category || '').trim(),
        oneline: (obj.oneline || '').trim(),
      };
    }
  } catch (_) {
    /* fallthrough */
  }

  // 3) 폴백: 첫 줄 제목, 나머지 본문
  const lines = raw.split('\n');
  const title = (lines.shift() || '').replace(/^#+\s*|^\[제목:?\s*|\]$/g, '').trim();
  return { title: sanitize(title), body: sanitize(lines.join('\n').trim()), tags: [], category: '', oneline: '' };
}

/**
 * GPT API 로 블로그 글을 생성한다.
 * @param {object} o
 * @param {string} o.apiKey         OpenAI API 키
 * @param {string} o.model          모델명 (기본 gpt-4o)
 * @param {string} o.rootDir        프로젝트 루트(blog.md 위치)
 * @param {string} o.keyword        핵심 키워드/주제
 * @param {string} o.experience     사용자 경험 한 줄
 * @param {string} o.prompt         추가 지시
 * @param {string[]} o.images       data URL 형식 이미지 배열(base64)
 * @returns {Promise<{text:string, usage?:object}>}
 */
async function generatePost({
  apiKey,
  model = 'gpt-4o',
  rootDir,
  keyword,
  experience,
  prompt,
  images = [],
  captions = [],
  categories = [],
  rating = 0,
  ratingReason = '',
}) {
  if (!apiKey) throw new Error('OpenAI API 키가 없습니다. .env 파일을 확인하세요.');

  const system = loadSystemPrompt(rootDir);
  const hasCaptions = captions.some((c) => c && c.trim());
  const userText = buildUserText({
    keyword,
    experience,
    prompt,
    imageCount: images.length,
    categories,
    captions,
    rating,
    ratingReason,
  });

  // 비전(이미지 포함) 메시지 구성
  const userContent = [{ type: 'text', text: userText }];
  for (const dataUrl of images) {
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
      userContent.push({ type: 'image_url', image_url: { url: dataUrl } });
    }
  }

  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    temperature: 0.85,
    max_tokens: 7000, // 한글 2,700자 분량까지 안전하게 (토큰 ≈ 글자수보다 큼)
    // blog.md 가 [TITLE]/[BODY] 평문 형식을 지정하므로 JSON 강제를 풀었다.
  };

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const err = await res.json();
      detail = err.error?.message || JSON.stringify(err);
    } catch (_) {
      detail = await res.text();
    }
    throw new Error(`OpenAI API 오류 (${res.status}): ${detail}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim() || '';
  if (!text) throw new Error('생성된 글이 비어 있습니다.');

  const parsed = parseResult(text);
  if (!parsed.title && !parsed.body) throw new Error('제목/본문 파싱에 실패했습니다.');

  // 사진 설명이 있으면 GPT 가 매긴 번호를 유지(맥락 매핑), 없으면 등장 순서대로 재번호.
  const numbered = hasCaptions
    ? normalizeImageTokens(parsed.body)
    : numberImageTokens(parsed.body);

  return {
    title: parsed.title,
    body: numbered,
    tags: parsed.tags || [],
    category: parsed.category || '',
    oneline: parsed.oneline || '',
    usage: data.usage,
    imageTokens: countImageTokens(numbered),
  };
}

// 모든 이미지 토큰을 단독 줄의 [IMGn] 으로 정규화하고 1부터 순번을 매긴다.
function numberImageTokens(body) {
  let n = 0;
  return body.replace(/\[\s*IMG\s*\d*\s*\]/gi, () => `[IMG${++n}]`);
}

// GPT 가 매긴 번호는 유지하고 형식만 [IMGn] 으로 정규화한다.
// 번호 없는 [IMG] 만 빈 순번으로 채운다.
function normalizeImageTokens(body) {
  let auto = 0;
  return body.replace(/\[\s*IMG\s*(\d*)\s*\]/gi, (_, num) =>
    num ? `[IMG${num}]` : `[IMG${++auto}]`
  );
}

function countImageTokens(body) {
  const m = body.match(/\[IMG\d+\]/gi);
  return m ? m.length : 0;
}

module.exports = { generatePost };
