'use strict';

// 일부 환경에는 ELECTRON_RUN_AS_NODE=1 이 설정되어 있어 `electron .` 가
// GUI 대신 순수 Node 로 실행된다(app 이 undefined 가 됨). 여기서 강제로 제거한다.
const { spawn } = require('child_process');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const electron = require('electron'); // 설치된 electron 바이너리 경로(문자열)

const child = spawn(electron, ['.'], { stdio: 'inherit', env });
child.on('close', (code) => process.exit(code));
