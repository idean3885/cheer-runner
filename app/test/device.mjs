// 실기기 배경 수신 자동 시험.
//
// 화면 잠금은 호스트에서 걸 수 없다. 그래서 그 대신 다른 앱을 띄워 우리 앱을
// 배경으로 보낸다. 잠금보다 느슨한 조건이지만, 여기서 0건이면 잠금에서도 0건이므로
// 사람이 나가기 전에 걸러낼 수 있다.
//
// 사람이 미리 해둘 것은 둘뿐이다. 기기 연결과 위치 권한 «항상 허용».
// 시작 버튼은 누르지 않는다. 표식 파일을 넣어 앱이 스스로 시작한다.
//
// 실행: node test/device.mjs

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SPEECH_MSG } from '../src/application/DiagnosticSession.js';

const BUNDLE = 'me.idean.cheerrunner';
const OTHER = 'com.apple.Preferences';   // 우리 앱을 배경으로 보내는 데만 쓴다
const FOREGROUND_MS = 12000;
const BACKGROUND_MS = 30000;
// 음성 완료를 기다리는 간격과 횟수. 한 문장은 3초 안쪽이고 요청은 20초에 한 번이므로
// 이 정도면 요청 하나가 반드시 끝난다
const GRACE_MS = 5000;
const GRACE_TRIES = 6;

function run(args, opts) {
  return new Promise(function (resolve, reject) {
    execFile('xcrun', args, { maxBuffer: 8 << 20, timeout: (opts && opts.timeout) || 120000 },
      function (err, stdout, stderr) {
        if (err && !(opts && opts.allowFail)) reject(new Error(stderr || stdout || err.message));
        else resolve(stdout + stderr);
      });
  });
}

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

function fail(msg) { console.log('\n실패: ' + msg); process.exit(1); }

async function findDevice() {
  const out = await run(['devicectl', 'list', 'devices']);
  const line = out.split('\n').find(function (l) { return /iPhone|iPad/.test(l) && /connected/.test(l); });
  if (!line) throw new Error('연결된 기기가 없습니다. 케이블을 꽂고 잠금을 해제하세요');
  const id = line.trim().split(/\s+/).find(function (t) { return /^[0-9A-F]{8}-/.test(t); });
  if (!id) throw new Error('기기 식별자를 읽지 못했습니다: ' + line.trim());
  return id;
}

async function pushMarker(dev, dir) {
  const marker = path.join(dir, 'auto-start');
  fs.writeFileSync(marker, '');
  await run(['devicectl', 'device', 'copy', 'to', '--device', dev,
    '--domain-type', 'appDataContainer', '--domain-identifier', BUNDLE,
    '--source', marker, '--destination', 'Documents/auto-start']);
}

async function pullTrace(dev, dir) {
  // 목적지는 파일 경로여야 한다. 디렉토리를 주면 «Is a directory» 로 끊긴다
  const f = path.join(dir, 'trace.jsonl');
  fs.rmSync(f, { force: true });
  await run(['devicectl', 'device', 'copy', 'from', '--device', dev,
    '--domain-type', 'appDataContainer', '--domain-identifier', BUNDLE,
    '--source', 'Documents/trace.jsonl', '--destination', f], { allowFail: true });
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n')
    .filter(function (l) { return l.trim().length > 2; })
    .map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } })
    .filter(Boolean);
}

async function launch(dev, bundle) {
  try {
    return await run(['devicectl', 'device', 'process', 'launch', '--device', dev,
      '--terminate-existing', bundle]);
  } catch (e) {
    // 무료 개인 팀 서명은 기기에서 개발자를 한 번 신뢰해야 실행된다.
    // 처음 한 번뿐이지만 사람이 해야 하므로 무엇을 해야 하는지 그대로 알린다
    if (/invalid code signature|not been explicitly trusted/.test(e.message)) {
      fail('기기가 이 개발자를 아직 신뢰하지 않습니다.\n'
        + '      설정 → 일반 → VPN 및 기기 관리 → 개발자 앱 → 신뢰\n'
        + '      그 뒤 홈 화면에서 앱을 한 번 실행하고 위치 권한을 «항상 허용» 으로 주세요');
    }
    if (/locked|passcode/i.test(e.message)) {
      fail('기기가 잠겨 있습니다. 잠금을 해제하고 다시 실행하세요');
    }
    throw e;
  }
}

/* ── 실행 ─────────────────────────────────────────────────────── */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-device-'));
const dev = await findDevice();
console.log('기기 ' + dev);

console.log('표식을 넣고 앱을 띄웁니다 (시작 버튼을 누르지 않습니다)');
await pushMarker(dev, dir);
await launch(dev, BUNDLE);

console.log('전경에서 ' + FOREGROUND_MS / 1000 + '초 기다립니다');
await sleep(FOREGROUND_MS);

let trace = await pullTrace(dev, dir);
const started = trace.some(function (m) { return /배경 구독 등록 완료/.test(m.msg); });
if (!started) {
  const perm = trace.find(function (m) { return /배경 권한/.test(m.msg); });
  fail('자동 시작이 되지 않았습니다.' + (perm ? ' 기록: ' + perm.msg : ' 기록이 비었습니다')
    + '\n      위치 권한을 «항상 허용» 으로 두었는지 확인하세요');
}
const fgFixes = trace.filter(function (m) { return m.kind === 'bg'; }).length;
console.log('  전경 구간 배경 수신 ' + fgFixes + '건');

console.log('다른 앱을 띄워 배경으로 보냅니다. ' + BACKGROUND_MS / 1000 + '초 기다립니다');
await launch(dev, OTHER);
await sleep(BACKGROUND_MS);

// 한 번 보고 판정하면 음성 간격과 판정 시점이 맞물려야 통과한다. 실제로 재생 완료가
// 2초 뒤에 와서 두 번 잘못 실패했다. 조건이 채워질 때까지 되풀이해 본다
let judged = null;
for (let i = 0; i <= GRACE_TRIES; i++) {
  trace = await pullTrace(dev, dir);

  // 경계는 기기가 남긴 시각으로 잡는다. 노트북 시계로 잡으면 두 시계의 차이가
  // 그대로 판정 오차가 된다. 앱이 배경으로 밀린 사실을 아는 것은 앱 자신이다
  const entered = trace.filter(function (m) { return /배경 진입/.test(m.msg); });
  if (!entered.length) fail('앱이 배경 진입을 기록하지 않았습니다. 화면 상태 감지가 끊겼습니다');
  const from = entered[entered.length - 1].at;
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

const hidden = judged.hidden;
const errors = judged.errors;
const asked = judged.asked;
const played = judged.played;
const cut = judged.cut;

console.log('\n판정');
console.log('  배경 구간 수신 ' + hidden.length + '건');
console.log('  음성 요청 ' + asked + '건 · 끝까지 재생 ' + played + '건 · 중단 ' + cut + '건');
console.log('  오류 ' + errors.length + '건');
errors.slice(0, 3).forEach(function (e) { console.log('    ' + e.msg); });

// 앱을 다시 띄워 구독을 정리한다. 남기면 iOS 가 계속 깨운다
await launch(dev, BUNDLE);
await sleep(3000);

if (hidden.length === 0) {
  fail('배경으로 밀린 동안 위치가 한 건도 오지 않았습니다.\n'
    + '      웹과 같은 결과입니다. 화면 잠금으로 나가기 전에 이 구간을 먼저 통과해야 합니다');
}
if (errors.length) fail('오류가 있습니다. 위 기록을 보세요');
if (asked === 0) {
  fail('배경 구간에 음성 요청이 없었습니다. 대기 시간이 음성 간격보다 짧은지 확인하세요');
}
if (played === 0) {
  fail('음성을 요청했지만 끝까지 재생된 기록이 없습니다 (중단 ' + cut + '건).\n'
    + '      배경에서 오디오 세션이 잡히지 않는 상태입니다. 볼륨 문제가 아니라 설정 문제입니다');
}

console.log('\n통과. 배경 ' + hidden.length + '건 수신, 음성 ' + played + '건 끝까지 재생');
console.log('소프트웨어가 볼 수 없는 것은 기기 볼륨과 무음 스위치 둘뿐입니다');
fs.rmSync(dir, { recursive: true, force: true });
