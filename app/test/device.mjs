// 진단 경로 기기 시험. 사람 손 없이 돈다.
//
// 확인하는 것은 둘이다. 배경에서 위치가 계속 오는가, 그 동안 음성이 끝까지 재생되는가.
// 웹 프로토타입은 첫째가 0건이었고, 이 앱은 처음에 둘째가 0건이었다.
//
// 사람이 미리 해둘 것은 기기 연결과 위치 권한 «항상 허용» 뿐이다.
//
// 실행: node test/device.mjs

import fs from 'node:fs';
import { SPEECH_MSG } from '../src/application/DiagnosticSession.js';
import {
  BUNDLE, OTHER, sleep, fail, workDir, findDevice, pushMarker, pullTrace, launch, hiddenFrom,
  clearSession
} from './device-lib.mjs';

const FOREGROUND_MS = 12000;
const BACKGROUND_MS = 30000;
// 음성 완료를 기다리는 간격과 횟수. 한 번 보고 판정하면 요청 주기와 판정 시점이
// 맞물려야 통과한다. 실제로 완료가 2초 뒤에 와서 두 번 잘못 실패했다
const GRACE_MS = 5000;
const GRACE_TRIES = 6;

const dir = workDir();
const dev = await findDevice();
console.log('기기 ' + dev);

console.log('진단 표식을 넣고 앱을 띄웁니다 (시작 버튼을 누르지 않습니다)');
await pushMarker(dev, dir, 'auto-start');
await launch(dev, BUNDLE);

console.log('전경에서 ' + FOREGROUND_MS / 1000 + '초 기다립니다');
await sleep(FOREGROUND_MS);

let trace = await pullTrace(dev, dir);
if (!trace.some(function (m) { return /배경 구독 등록 완료/.test(m.msg); })) {
  const perm = trace.find(function (m) { return /배경 권한/.test(m.msg); });
  fail('자동 시작이 되지 않았습니다.' + (perm ? ' 기록: ' + perm.msg : ' 기록이 비었습니다')
    + '\n      위치 권한을 «항상 허용» 으로 두었는지 확인하세요');
}
console.log('  전경 구간 배경 수신 ' + trace.filter(function (m) { return m.kind === 'bg'; }).length + '건');

console.log('다른 앱을 띄워 배경으로 보냅니다. ' + BACKGROUND_MS / 1000 + '초 기다립니다');
await launch(dev, OTHER);
await sleep(BACKGROUND_MS);

let judged = null;
for (let i = 0; i <= GRACE_TRIES; i++) {
  trace = await pullTrace(dev, dir);
  const from = hiddenFrom(trace);
  if (from == null) fail('앱이 배경 진입을 기록하지 않았습니다. 화면 상태 감지가 끊겼습니다');
  const since = function (msg) {
    return trace.filter(function (m) { return m.msg === msg && m.at >= from; }).length;
  };
  judged = {
    hidden: trace.filter(function (m) { return m.kind === 'bg' && m.at >= from; }),
    errors: trace.filter(function (m) { return m.kind === 'err'; }),
    asked: since(SPEECH_MSG.request),
    played: since(SPEECH_MSG.done),
    cut: since(SPEECH_MSG.stopped)
  };
  if (judged.played > 0 || i === GRACE_TRIES) break;
  console.log('  음성 완료를 기다립니다 (' + (i + 1) + '/' + GRACE_TRIES + ')');
  await sleep(GRACE_MS);
}

console.log('\n판정');
console.log('  배경 구간 수신 ' + judged.hidden.length + '건');
console.log('  음성 요청 ' + judged.asked + '건 · 끝까지 재생 ' + judged.played
  + '건 · 중단 ' + judged.cut + '건');
console.log('  오류 ' + judged.errors.length + '건');
judged.errors.slice(0, 3).forEach(function (e) { console.log('    ' + e.msg); });

// 세션 기록을 비우고 다시 띄워 구독을 정리한다. 진단 세션은 상한까지 살아 있도록
// 설계돼 있어서 재실행만으로는 끝나지 않는다. 실제로 시험이 끝난 뒤에도
// 20초마다 음성이 계속 나오는 상태가 됐다
await clearSession(dev, dir);
await launch(dev, BUNDLE);
await sleep(3000);

if (judged.hidden.length === 0) {
  fail('배경으로 밀린 동안 위치가 한 건도 오지 않았습니다.\n'
    + '      웹과 같은 결과입니다. 화면 잠금으로 나가기 전에 이 구간을 먼저 통과해야 합니다');
}
if (judged.errors.length) fail('오류가 있습니다. 위 기록을 보세요');
if (judged.asked === 0) {
  fail('배경 구간에 음성 요청이 없었습니다. 대기 시간이 음성 간격보다 짧은지 확인하세요');
}
if (judged.played === 0) {
  fail('음성을 요청했지만 끝까지 재생된 기록이 없습니다 (중단 ' + judged.cut + '건).\n'
    + '      배경에서 오디오 세션이 잡히지 않는 상태입니다. 볼륨 문제가 아니라 설정 문제입니다');
}

console.log('\n통과. 배경 ' + judged.hidden.length + '건 수신, 음성 '
  + judged.played + '건 끝까지 재생');
console.log('소프트웨어가 볼 수 없는 것은 기기 볼륨과 무음 스위치 둘뿐입니다');
fs.rmSync(dir, { recursive: true, force: true });
