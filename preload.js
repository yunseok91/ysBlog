'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 렌더러(UI)에서 안전하게 호출할 수 있는 API만 노출한다.
contextBridge.exposeInMainWorld('api', {
  // 로그인 실행. payload: { id, pw, save, show }
  login: (payload) => ipcRenderer.invoke('naver:login', payload),

  // 진행 상태 구독. callback({ stage, msg })
  onLoginStatus: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('naver:login-status', handler);
    return () => ipcRenderer.removeListener('naver:login-status', handler);
  },

  // 저장된 계정 관리
  listAccounts: () => ipcRenderer.invoke('creds:list'),
  getAccount: (id) => ipcRenderer.invoke('creds:get', id),
  deleteAccount: (id) => ipcRenderer.invoke('creds:delete', id),

  closeLoginWindow: () => ipcRenderer.invoke('naver:close-window'),

  // ----- 글쓰기 / GPT -----
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  generatePost: (payload) => ipcRenderer.invoke('ai:generate', payload),
  openWritePage: (blogId) => ipcRenderer.invoke('naver:open-write', blogId),

  // 에디터에 키입력
  insertPost: (payload) => ipcRenderer.invoke('naver:insert-post', payload),
  onInsertStatus: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('naver:insert-status', handler);
    return () => ipcRenderer.removeListener('naver:insert-status', handler);
  },

  // 발행 / 카테고리
  loadCategories: () => ipcRenderer.invoke('naver:load-categories'),
  publish: (payload) => ipcRenderer.invoke('naver:publish', payload),
  onPublishStatus: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('naver:publish-status', handler);
    return () => ipcRenderer.removeListener('naver:publish-status', handler);
  },
});
