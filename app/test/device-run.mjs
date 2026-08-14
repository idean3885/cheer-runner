// 달리기 경로 기기 시험. 사람 손 없이 돈다.
//
// 진단 경로만 자동화해 두면 확인된 것은 진단이고 제품은 아니다. 러너가 쓰는 길은
// 달리기 화면이므로 그 길도 같은 방식으로 확인한다.
//
// 사람이 미리 해둘 것은 기기 연결과 위치 권한 «항상 허용» 뿐이다.
// 시작 버튼은 누르지 않는다. 표식 파일을 넣어 앱이 스스로 시작한다.
//
// 실행: node test/device-run.mjs

import fs from 'node:fs';
import {
  BUNDLE, OTHER, sleep, fail, workDir, findDevice, pushMarker, pullTrace, launch, hiddenFrom
} from './device-lib.mjs';

const FOREGROUND_MS = 12000;
const BACKGROUND_MS = 30000;
const GRACE_MS = 5000;
const GRACE_TRIES = 4;

const dir = workDir();
const dev = await findDevice();
console.log('기기 ' + dev);

console.log('달리기 표식을 넣고 앱을 띄웁니다 (시작 버튼을 누르지 않습니다)');
await pushMarker(dev, dir, 'auto-run');
await launch(dev, BUNDLE);

console.log('전경에서 ' + FOREGROUND_MS / 1000 + '초 기다립니다');
await sleep(FOREGROUND_MS);

let trace = await pullTrace(dev, dir);
if (!trace.some(function (m) { return /달리기 시작/.test(m.msg); })) {
  const why = trace.find(function (m) { return m.kind === 'err'; });
  fail('달리기가 시작되지 않았습니다.' + (why ? ' 기록: ' + why.msg : ' 기록이 비었습니다')
    + '\n      위치 권한을 «항상 허용» 으로 두었는지 확인하세요');
}
const fgFixes = trace.filter(function (m) { return m.kind === 'bg'; }).length;
console.log('  전경 구간 위치 ' + fgFixes + '건');

console.log('다른 앱을 띄워 배경으로 보냅니다. ' + BACKGROUND_MS / 1000 + '초 기다립니다');
await launch(dev, OTHER);
await sleep(BACKGROUND_MS);

let judged = null;
for (let i = 0; i <= GRACE_TRIES; i++) {
  trace = await pullTrace(dev, dir);
  const from = hiddenFrom(trace);
  if (from == null) fail('앱이 배경 진입을 기록하지 않았습니다');
  judged = {
    fixes: trace.filter(function (m) { return m.kind === 'bg' && m.at >= from; }),
    errors: trace.filter(function (m) { return m.kind === 'err'; }),
    dist: lastDistance(trace)
  };
  if (judged.fixes.length > 0 || i === GRACE_TRIES) break;
  console.log('  배경 위치를 기다립니다 (' + (i + 1) + '/' + GRACE_TRIES + ')');
  await sleep(GRACE_MS);
}

function lastDistance(lines) {
  const bg = lines.filter(function (m) { return m.kind === 'bg'; });
  if (!bg.length) return null;
  const m = /누적 (\d+)m/.exec(bg[bg.length - 1].msg);
  return m ? Number(m[1]) : null;
}

console.log('\n판정');
console.log('  배경 구간 위치 ' + judged.fixes.length + '건');
console.log('  누적 거리 ' + (judged.dist != null ? judged.dist + 'm' : '없음'));
console.log('  오류 ' + judged.errors.length + '건');
judged.errors.slice(0, 3).forEach(function (e) { console.log('    ' + e.msg); });

// 앱을 다시 띄워 달리기를 정리한다. 남기면 iOS 가 계속 깨운다
await launch(dev, BUNDLE);
await sleep(3000);

if (judged.fixes.length === 0) {
  fail('배경으로 밀린 동안 달리기가 위치를 한 건도 받지 못했습니다.\n'
    + '      진단은 통과하는데 달리기가 못 받는다면 분배가 잘못된 것입니다');
}
if (judged.errors.length) fail('오류가 있습니다. 위 기록을 보세요');

console.log('\n통과. 달리기가 배경에서 위치 ' + judged.fixes.length + '건을 받았습니다');
console.log('제자리 시험이므로 거리는 늘지 않습니다. 거리 정확도는 실측에서 봅니다');
fs.rmSync(dir, { recursive: true, force: true });
