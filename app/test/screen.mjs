// 화면 확인. 시뮬레이터를 띄워 그림을 남긴다.
//
// 이것이 없어서 결함 셋을 놓쳤다. 종료 뒤에도 시간이 흘렀고, 제자리에서 페이스가
// 폭주했고, 화면 3분의 2가 비어 있었다. 시험은 모두 통과했고 기기 시험도 통과했다.
// 값이 맞는지는 시험이 보지만 화면이 어떻게 보이는지는 보는 수밖에 없다.
//
// 사람이 눈으로 볼 그림을 만드는 것이 이 파일의 일이고, 판정은 그림을 보는 쪽이 한다.
// 다만 앱이 죽었는지는 여기서 판정한다. 죽은 화면은 그림으로도 알기 어렵다.
//
// 실행: node test/screen.mjs [출력 디렉토리]
//   미리: npm run build:sim (시뮬레이터용 빌드)

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BUNDLE = 'me.idean.cheerrunner';
const LAT = 37.5665, LON = 126.9780;
const STEP_M = 3;          // 초당 3m. 가벼운 달리기
const STEPS = 40;

const outDir = process.argv[2] || path.join(process.cwd(), 'tools', 'shots');

function run(cmd, args, opts) {
  return new Promise(function (resolve, reject) {
    execFile(cmd, args, { maxBuffer: 8 << 20, timeout: 300000 }, function (err, stdout, stderr) {
      if (err && !(opts && opts.allowFail)) reject(new Error(stderr || stdout || err.message));
      else resolve((stdout || '') + (stderr || ''));
    });
  });
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
function fail(msg) { console.log('\n실패: ' + msg); process.exit(1); }
function north(m) { return LAT + (m / 6371000) * 180 / Math.PI; }

async function bootedDevice() {
  const out = await run('xcrun', ['simctl', 'list', 'devices', 'booted']);
  const m = /\(([0-9A-F-]{36})\) \(Booted\)/.exec(out);
  if (m) return m[1];
  // 부팅된 것이 없으면 iPhone 하나를 띄운다
  const all = await run('xcrun', ['simctl', 'list', 'devices', 'available']);
  const line = all.split('\n').find(function (l) { return /iPhone/.test(l) && /\(Shutdown\)/.test(l); });
  if (!line) fail('쓸 수 있는 시뮬레이터가 없습니다');
  const id = /\(([0-9A-F-]{36})\)/.exec(line)[1];
  console.log('시뮬레이터를 띄웁니다 ' + id);
  await run('xcrun', ['simctl', 'boot', id], { allowFail: true });
  await sleep(15000);
  return id;
}

async function simulatorApp() {
  const out = await run('xcodebuild', ['-workspace', 'ios/app.xcworkspace', '-scheme', 'app',
    '-configuration', 'Release', '-sdk', 'iphonesimulator', '-showBuildSettings']);
  const m = /BUILT_PRODUCTS_DIR = (.+)/.exec(out);
  if (!m) fail('빌드 산출물 위치를 찾지 못했습니다');
  const app = path.join(m[1].trim(), 'app.app');
  if (!fs.existsSync(app)) {
    fail('시뮬레이터용 빌드가 없습니다. 먼저 npm run build:sim 을 실행하세요\n      찾은 자리: ' + app);
  }
  return app;
}

async function documents(dev) {
  const out = await run('xcrun', ['simctl', 'get_app_container', dev, BUNDLE, 'data']);
  const dir = path.join(out.trim(), 'Documents');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function shot(dev, name) {
  const file = path.join(outDir, name + '.png');
  await run('xcrun', ['simctl', 'io', dev, 'screenshot', file]);
  console.log('  ' + file);
  return file;
}

async function alive(dev) {
  const out = await run('xcrun', ['simctl', 'spawn', dev, 'launchctl', 'list'], { allowFail: true });
  return out.indexOf(BUNDLE) >= 0;
}

/* ── 실행 ─────────────────────────────────────────────────────── */
fs.mkdirSync(outDir, { recursive: true });
const dev = await bootedDevice();
const app = await simulatorApp();
console.log('기기 ' + dev);

await run('xcrun', ['simctl', 'terminate', dev, BUNDLE], { allowFail: true });
await run('xcrun', ['simctl', 'install', dev, app]);
await run('xcrun', ['simctl', 'privacy', dev, 'grant', 'location-always', BUNDLE], { allowFail: true });
await run('xcrun', ['simctl', 'location', dev, 'set', LAT + ',' + LON]);

// 1. 시작 전 화면. 코스를 비워 첫 실행 상태를 본다
const docs = await documents(dev);
['course.json', 'runs.jsonl', 'trace.jsonl', 'session.json', 'auto-run', 'auto-start']
  .forEach(function (f) { fs.rmSync(path.join(docs, f), { force: true }); });
await run('xcrun', ['simctl', 'launch', dev, BUNDLE]);
await sleep(8000);
console.log('시작 전 화면');
await shot(dev, '1-ready');

// 2. 지점이 있는 달리기. 코스를 심고 표식으로 스스로 시작시킨다
const path61 = [];
for (let i = 0; i <= 60; i++) path61.push({ lat: north(STEP_M * i), lon: LON });
fs.writeFileSync(path.join(docs, 'course.json'), JSON.stringify({
  id: 'course', name: '', path: path61,
  spots: [
    { id: 's1', lat: north(60), lon: LON, rad: 30 },
    { id: 's2', lat: north(150), lon: LON, rad: 30 }
  ]
}));
fs.writeFileSync(path.join(docs, 'auto-run'), '');
await run('xcrun', ['simctl', 'terminate', dev, BUNDLE], { allowFail: true });
await run('xcrun', ['simctl', 'launch', dev, BUNDLE]);
await sleep(4000);

console.log('위치를 ' + STEPS + '초 흘려 넣습니다');
for (let i = 1; i <= STEPS; i++) {
  await run('xcrun', ['simctl', 'location', dev, 'set', north(STEP_M * i).toFixed(7) + ',' + LON]);
  await sleep(1000);
}
console.log('달리기 중 화면');
await shot(dev, '2-running');

if (!(await alive(dev))) fail('앱이 죽었습니다. 그림만으로는 알기 어려운 상태입니다');

// 3. 위치를 받지 못하는 화면. 지하에서 달리기를 눌렀을 때의 자리다.
// 시뮬레이터에서 지하를 만들 수는 없으므로 위치 접근을 거두어 같은 결과를 만든다
await run('xcrun', ['simctl', 'terminate', dev, BUNDLE], { allowFail: true });
await run('xcrun', ['simctl', 'privacy', dev, 'revoke', 'location', BUNDLE], { allowFail: true });
['course.json', 'runs.jsonl', 'trace.jsonl', 'session.json', 'auto-run', 'auto-start']
  .forEach(function (f) { fs.rmSync(path.join(docs, f), { force: true }); });
await run('xcrun', ['simctl', 'launch', dev, BUNDLE]);
// 위치 한 건을 기다리는 한계가 8초다. 그 뒤에 판정이 선다
await sleep(14000);
console.log('위치를 못 받는 화면');
await shot(dev, '3-blocked');
await run('xcrun', ['simctl', 'privacy', dev, 'grant', 'location-always', BUNDLE], { allowFail: true });

if (!(await alive(dev))) fail('앱이 죽었습니다. 그림만으로는 알기 어려운 상태입니다');

console.log('\n그림 ' + 3 + '장을 만들었습니다. ' + outDir);
console.log('보는 것: 시간이 흐르는가 · 페이스가 사람 범위인가 · 지도와 지점이 그려지는가 · 빈 공간이 남는가');
console.log('        못 받는 화면에서 배너가 맨 위에 있는가 · 달리기 버튼이 잠겼는가');
