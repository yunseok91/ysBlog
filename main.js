'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const naverLogin = require('./src/automation/naverLogin');
const naverEditor = require('./src/automation/naverEditor');
const naverPublish = require('./src/automation/naverPublish');
const credentials = require('./src/storage/credentials');
const { loadEnv } = require('./src/ai/env');
const { generatePost } = require('./src/ai/generatePost');

// 사용자가 편집하는 파일(.env, blog.md)의 위치.
//  - 개발 중: 프로젝트 폴더
//  - 패키징(exe): 실행 파일이 있는 폴더 (포터블이면 PORTABLE_EXECUTABLE_DIR)
function appBaseDir() {
  if (!app.isPackaged) return __dirname;
  return process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
}

// 앱에 번들된 기본 파일이 들어있는 폴더.
function bundledDir() {
  return app.isPackaged ? process.resourcesPath : __dirname;
}

// exe 옆에 .env / blog.md 가 없으면 기본값을 만들어 둔다(첫 실행).
function ensureUserFiles() {
  const base = appBaseDir();
  try {
    // blog.md: 번들된 기본 프롬프트 복사
    const blogDst = path.join(base, 'blog.md');
    if (!fs.existsSync(blogDst)) {
      const blogSrc = path.join(bundledDir(), 'blog.md');
      if (fs.existsSync(blogSrc)) fs.copyFileSync(blogSrc, blogDst);
    }
    // .env: 없으면 템플릿 생성 (키는 사용자가 입력)
    const envDst = path.join(base, '.env');
    if (!fs.existsSync(envDst)) {
      const envSrc = path.join(bundledDir(), 'default.env');
      if (fs.existsSync(envSrc)) {
        fs.copyFileSync(envSrc, envDst);
      } else {
        fs.writeFileSync(
          envDst,
          '# OpenAI(GPT) API 설정\nOPENAI_API_KEY=\nOPENAI_MODEL=gpt-4o-mini\nNAVER_BLOG_ID=ys_note91\n',
          'utf8'
        );
      }
    }
  } catch (e) {
    console.error('[init] 사용자 파일 준비 실패:', e);
  }
}

// .env 에서 읽은 설정 (whenReady 에서 로드).
let ENV = { apiKey: '', model: 'gpt-4o-mini', blogId: 'ys_note91' };

let mainWin = null;

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    title: '네이버 블로그 자동화',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWin.removeMenu();
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  ensureUserFiles();
  ENV = loadEnv(appBaseDir());
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ----- IPC: 로그인 실행 -----
ipcMain.handle('naver:login', async (event, payload) => {
  const { id, pw, save, show } = payload || {};
  try {
    const result = await naverLogin.runLogin({
      id,
      pw,
      show: show !== false,
      onStatus: (stage, msg) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('naver:login-status', { stage, msg });
        }
      },
    });

    // 성공 시 저장 옵션이 켜져 있으면 자격증명 저장.
    if (result.success && save) {
      credentials.saveAccount(id, pw);
    }

    console.log('[login] success =', result.success, '| url =', result.url);

    // 로그인 성공 시 자동으로 글쓰기 페이지로 리다이렉션.
    if (result.success) {
      try {
        if (!event.sender.isDestroyed()) {
          event.sender.send('naver:login-status', {
            stage: 'redirect',
            msg: '글쓰기 페이지로 이동 중...',
          });
        }
        const w = await naverLogin.openWritePage(ENV.blogId);
        result.writeUrl = w.finalUrl || w.url;
        console.log('[login] redirect done. finalUrl =', w.finalUrl);

        // 글쓰기 페이지의 "작성 중이던 글" 팝업 등을 자동으로 닫는다.
        naverEditor
          .dismissEditorPopups({ onLog: (m) => console.log('[popup]', m) })
          .catch((e) => console.error('[popup] error:', e));
      } catch (e) {
        // 리다이렉션 실패는 로그인 성공 자체를 막지 않는다.
        result.redirectError = e.message || String(e);
        console.error('[login] redirect error:', e);
      }
    }
    return result;
  } catch (err) {
    return { success: false, message: err.message || String(err) };
  }
});

// ----- IPC: 자격증명 관리 -----
ipcMain.handle('creds:list', () => credentials.listAccounts());
ipcMain.handle('creds:get', (e, id) => credentials.getAccount(id));
ipcMain.handle('creds:delete', (e, id) => {
  credentials.deleteAccount(id);
  return credentials.listAccounts();
});

ipcMain.handle('naver:close-window', () => {
  naverLogin.closeLoginWindow();
  return true;
});

// ----- IPC: 글쓰기 페이지로 이동 -----
ipcMain.handle('naver:open-write', async (e, blogId) => {
  try {
    const id = blogId || ENV.blogId;
    return await naverLogin.openWritePage(id);
  } catch (err) {
    return { error: err.message || String(err) };
  }
});

// ----- IPC: GPT 키 로드 상태 -----
ipcMain.handle('ai:status', () => ({
  hasKey: !!ENV.apiKey,
  model: ENV.model,
  blogId: ENV.blogId,
}));

// ----- IPC: GPT 글 생성 -----
ipcMain.handle('ai:generate', async (e, payload) => {
  const { keyword, experience, prompt, images, captions, categories, rating, ratingReason } = payload || {};
  try {
    const result = await generatePost({
      apiKey: ENV.apiKey,
      model: ENV.model,
      rootDir: appBaseDir(),
      keyword,
      experience,
      prompt,
      categories: Array.isArray(categories) ? categories : [],
      images: Array.isArray(images) ? images : [],
      captions: Array.isArray(captions) ? captions : [],
      rating: Number(rating) || 0,
      ratingReason: ratingReason || '',
    });
    return {
      success: true,
      title: result.title,
      body: result.body,
      tags: result.tags,
      category: result.category,
      oneline: result.oneline,
      usage: result.usage,
      imageTokens: result.imageTokens,
    };
  } catch (err) {
    return { success: false, message: err.message || String(err) };
  }
});

// ----- IPC: 생성된 글을 에디터에 키입력 -----
ipcMain.handle('naver:insert-post', async (event, payload) => {
  const { title, body, images } = payload || {};
  if (!title && !body) return { success: false, message: '입력할 제목/본문이 없습니다.' };
  try {
    const r = await naverEditor.insertPost({
      title,
      body,
      images: Array.isArray(images) ? images : [],
      onLog: (msg) => {
        console.log('[insert]', msg);
        if (!event.sender.isDestroyed()) {
          event.sender.send('naver:insert-status', { msg });
        }
      },
    });
    return { success: true, ...r };
  } catch (err) {
    console.error('[insert] error:', err);
    return { success: false, message: err.message || String(err) };
  }
});

// ----- IPC: 카테고리 불러오기 -----
ipcMain.handle('naver:load-categories', async (event) => {
  try {
    const r = await naverPublish.loadCategories({
      onLog: (msg) => {
        console.log('[cat]', msg);
        if (!event.sender.isDestroyed()) event.sender.send('naver:publish-status', { msg });
      },
    });
    return { success: true, categories: r.categories };
  } catch (err) {
    console.error('[cat] error:', err);
    return { success: false, message: err.message || String(err) };
  }
});

// ----- IPC: 발행(카테고리/태그/공개설정/발행) -----
ipcMain.handle('naver:publish', async (event, payload) => {
  const { category, tags, visibility, publish } = payload || {};
  try {
    const r = await naverPublish.publish({
      category,
      tags,
      visibility,
      publish: !!publish,
      onLog: (msg) => {
        console.log('[publish]', msg);
        if (!event.sender.isDestroyed()) event.sender.send('naver:publish-status', { msg });
      },
    });
    return { success: true, ...r };
  } catch (err) {
    console.error('[publish] error:', err);
    return { success: false, message: err.message || String(err) };
  }
});
