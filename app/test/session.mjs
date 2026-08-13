// 주행 세션과 배경 분배 시험. 기기 없이 돈다.
//
// 잡는 것
//   - 배경 구독을 남의 세션이 받아 끊어버리지 않는가 (주행 중 측정이 멈추는 결함)
//   - 주인 없는 구독이 남지 않는가 (앱이 계속 깨어나던 결함)
//   - 지정한 지점에서 응원이 나가는가, 이번 주행에는 울리지 않는가
//   - 종료 뒤 이번 경로가 다음 주행의 이탈 판정 기준이 되는가
//
// 실행: node test/session.mjs

import { createRunSession, OWNER as RUN } from '../src/application/RunSession.js';
import { createDiagnosticSession, OWNER as DIAGNOSTIC } from '../src/application/DiagnosticSession.js';
import { createBackgroundRouter } from '../src/application/BackgroundRouter.js';
import { WAYPOINT_RAD } from '../src/domain/constants.js';
import { fakeClock, fakeTrace, fakeSession, fakeLocation, fakeSpeech } from './doubles.mjs';

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const T0 = 1_700_000_000_000;
const LAT = 37.5665, LON = 126.978;
function north(m) { return LAT + (m / 6371000) * 180 / Math.PI; }

function fix(spec) {
  const s = spec || {};
  return {
    coords: {
      latitude: s.lat != null ? s.lat : LAT,
      longitude: LON,
      accuracy: 5,
      speed: s.speed != null ? s.speed : 3,
      altitude: null, heading: null
    },
    timestamp: s.t
  };
}

function fakeStore(seed) {
  let course = seed || {};
  const runs = [];
  return {
    runs,
    readCourse: function () { return course; },
    writeCourse: function (c) { course = c; return true; },
    appendRun: function (s) { runs.push(s); return true; },
    written: function () { return course; }
  };
}

function build(opts) {
  const o = opts || {};
  const clock = fakeClock(T0);
  const session = fakeSession();
  const location = fakeLocation(o.location);
  const speech = fakeSpeech(o.speech);
  const store = fakeStore(o.course);
  let changes = 0;
  const s = createRunSession({
    location, speech, session, store,
    now: clock.now,
    onChange: function () { changes++; }
  });
  return { s, clock, session, location, speech, store, changed: function () { return changes; } };
}

/* ── 시작과 종료 ──────────────────────────────────────────────── */

test('배경 권한이 없으면 주행을 시작하지 않는다', async function () {
  const { s, location, session } = build({
    location: { permissions: { foreground: 'granted', background: 'denied' } }
  });
  const r = await s.start();
  assert(r.started === false, '권한 없이 시작했습니다');
  assert(location.state.startCalls === 0, '구독을 걸었습니다');
  assert(session.read() === null, '세션을 남겼습니다');
});

test('시작하면 세션에 주인이 적힌다', async function () {
  const { s, session } = build();
  await s.start();
  assert(session.read().owner === RUN, '주인이 ' + session.read().owner + ' 입니다');
});

test('구독 실패하면 주행을 남기지 않는다', async function () {
  const { s, session } = build({ location: { failStart: true } });
  const r = await s.start();
  assert(r.started === false, '실패했는데 시작으로 봤습니다');
  assert(session.read() === null, '세션이 남았습니다');
  assert(s.view().state === 'ready', '주행이 남았습니다');
});

test('종료하면 구독과 세션이 모두 사라진다', async function () {
  const { s, location, session, clock } = build();
  await s.start();
  s.onFixes({ error: null, fixes: [fix({ t: T0 })] });
  clock.advance(60000);
  const done = await s.finish('user');
  assert(done.finished === true, '종료되지 않았습니다');
  assert(location.state.running === false, '구독이 남았습니다');
  assert(session.read() === null, '세션이 남았습니다');
});

test('종료 요약에 거리와 도달이 담긴다', async function () {
  const { s, clock, store } = build({
    course: { spots: [{ id: 's1', lat: north(100), lon: LON, rad: WAYPOINT_RAD }], path: [] }
  });
  await s.start();
  for (let i = 0; i <= 40; i++) {
    clock.advance(i === 0 ? 0 : 1000);
    s.onFixes({ error: null, fixes: [fix({ t: T0 + i * 1000, lat: north(3 * i) })] });
  }
  const done = await s.finish('user');
  assert(done.summary.dist > 100, '거리가 ' + Math.round(done.summary.dist) + 'm 입니다');
  assert(done.summary.arrivals.length === 1, '도달이 기록되지 않았습니다');
  assert(store.runs.length === 1, '주행 기록이 저장되지 않았습니다');
});

test('종료하면 시간이 멈춘다', async function () {
  // 흐르는 시각을 넣으면 종료 뒤에도 시간이 늘어난다. 화면에서 바로 보이는 결함이다
  const { s, clock } = build();
  await s.start();
  s.onFixes({ error: null, fixes: [fix({ t: T0 })] });
  clock.advance(60000);
  await s.finish('user');
  const atFinish = s.view().ms;
  clock.advance(120000);
  assert(s.view().ms === atFinish, '종료 뒤에도 시간이 늘었습니다 ('
    + atFinish + ' → ' + s.view().ms + ')');
});

test('제자리에서는 페이스를 내지 않는다', async function () {
  // 잡음 몇 미터를 긴 시간으로 나누면 사람이 낼 수 없는 값이 나온다
  const { s, clock } = build();
  await s.start();
  s.onFixes({ error: null, fixes: [fix({ t: T0, speed: 0 })] });
  for (let i = 1; i <= 60; i++) {
    clock.advance(1000);
    s.onFixes({ error: null, fixes: [fix({ t: T0 + i * 1000, speed: 0 })] });
  }
  const v = s.view();
  assert(v.dist < 100, '제자리인데 거리가 ' + Math.round(v.dist) + 'm 늘었습니다');
  assert(v.pace === null, '표본이 모자란데 페이스 ' + v.pace + ' 를 냈습니다');
});

test('충분히 달리면 페이스를 낸다', async function () {
  const { s, clock } = build();
  await s.start();
  s.onFixes({ error: null, fixes: [fix({ t: T0 })] });
  for (let i = 1; i <= 60; i++) {
    clock.advance(1000);
    s.onFixes({ error: null, fixes: [fix({ t: T0 + i * 1000, lat: north(3 * i) })] });
  }
  const v = s.view();
  assert(v.dist >= 100, '거리가 ' + Math.round(v.dist) + 'm 입니다');
  assert(v.pace != null, '충분히 달렸는데 페이스가 없습니다');
  assert(v.pace > 200 && v.pace < 500, '페이스가 사람 범위를 벗어났습니다: ' + Math.round(v.pace));
});

/* ── 응원 ─────────────────────────────────────────────────────── */

test('지정한 지점에 닿으면 응원이 나간다', async function () {
  const { s, speech, clock } = build({
    course: { spots: [{ id: 's1', lat: north(100), lon: LON, rad: WAYPOINT_RAD }], path: [] }
  });
  await s.start();
  const before = speech.said.length;
  for (let i = 0; i <= 40; i++) {
    clock.advance(i === 0 ? 0 : 1000);
    s.onFixes({ error: null, fixes: [fix({ t: T0 + i * 1000, lat: north(3 * i) })] });
  }
  const added = speech.said.slice(before);
  assert(added.some(function (t) { return /1번 지점/.test(t); }),
    '지점 응원이 없습니다: ' + JSON.stringify(added));
});

test('응원 문구에 구간 페이스가 들어간다', async function () {
  const { s, speech, clock } = build({
    course: { spots: [{ id: 's1', lat: north(100), lon: LON, rad: WAYPOINT_RAD }], path: [] }
  });
  await s.start();
  for (let i = 0; i <= 40; i++) {
    clock.advance(i === 0 ? 0 : 1000);
    s.onFixes({ error: null, fixes: [fix({ t: T0 + i * 1000, lat: north(3 * i) })] });
  }
  const line = speech.said.find(function (t) { return /1번 지점/.test(t); });
  assert(/구간 \d+분 \d+초/.test(line), '페이스 표기가 없습니다: ' + line);
});

test('여기 표시는 이번 주행에 울리지 않는다', async function () {
  const { s, speech, clock, store } = build({ course: { spots: [], path: [] } });
  await s.start();
  s.onFixes({ error: null, fixes: [fix({ t: T0 })] });
  clock.advance(1000);
  s.onFixes({ error: null, fixes: [fix({ t: T0 + 1000, lat: north(3) })] });

  const r = s.markHere();
  assert(r.marked === true, '표시되지 않았습니다: ' + r.reason);
  assert(store.written().spots.length === 1, '코스에 저장되지 않았습니다');

  const before = speech.said.length;
  clock.advance(1000);
  s.onFixes({ error: null, fixes: [fix({ t: T0 + 2000, lat: north(6) })] });
  const added = speech.said.slice(before);
  assert(!added.some(function (t) { return /지점입니다/.test(t); }),
    '이번 주행에서 울렸습니다: ' + JSON.stringify(added));
});

test('위치를 받기 전에는 여기 표시가 되지 않는다', async function () {
  const { s } = build();
  await s.start();
  const r = s.markHere();
  assert(r.marked === false, '위치 없이 표시됐습니다');
  assert(r.reason === 'no-position', '사유가 다릅니다: ' + r.reason);
});

/* ── 지도에서 지정 ────────────────────────────────────────────── */

test('코스를 벗어난 자리는 지도에서도 거부한다', async function () {
  const { s, store } = build({
    course: { spots: [], path: [{ lat: LAT, lon: LON }, { lat: north(500), lon: LON }] }
  });
  const r = s.pin(north(250) + 0.01, LON);
  assert(r.ok === false, '벗어난 자리를 받았습니다');
  assert(store.written().spots === undefined || store.written().spots.length === 0,
    '거부했는데 저장했습니다');
});

test('지도에서 찍은 지점은 이번 주행에도 목표가 된다', async function () {
  // 여기 표시와 다르다. 아직 지나지 않은 자리일 수 있으므로 이번 주행에도 울린다
  const { s, clock, speech } = build({
    course: { spots: [], path: [{ lat: LAT, lon: LON }, { lat: north(500), lon: LON }] }
  });
  await s.start();
  s.onFixes({ error: null, fixes: [fix({ t: T0 })] });
  const r = s.pin(north(100), LON);
  assert(r.ok === true, '경로 위인데 거부했습니다: ' + r.reason);
  assert(s.view().spots.length === 1, '지점이 목록에 없습니다');

  const before = speech.said.length;
  for (let i = 1; i <= 40; i++) {
    clock.advance(1000);
    s.onFixes({ error: null, fixes: [fix({ t: T0 + i * 1000, lat: north(3 * i) })] });
  }
  const added = speech.said.slice(before);
  assert(added.some(function (t) { return /1번 지점/.test(t); }),
    '이번 주행에서 울리지 않았습니다: ' + JSON.stringify(added));
});

test('코스가 없으면 지도 지정을 사유와 함께 거절한다', async function () {
  const { s } = build({ course: { spots: [], path: [] } });
  const r = s.pin(north(100), LON);
  assert(r.ok === false, '코스가 없는데 받았습니다');
  assert(r.reason === 'no-course', '사유가 다릅니다: ' + r.reason);
});

test('주행 전에 위치를 한 번 받아 지도 자리를 잡는다', async function () {
  const { s } = build();
  assert(s.view().here === null, '받기 전에 자리가 있습니다');
  await s.locate();
  const here = s.view().here;
  assert(here && here.lat != null, '위치를 받지 못했습니다');
});

test('위치를 못 받아도 무너지지 않는다', async function () {
  const { s } = build({ location: { failOnce: true } });
  const r = await s.locate();
  assert(r === null, '실패인데 값을 돌려줬습니다');
  assert(s.view().state === 'ready', '상태가 바뀌었습니다');
});

/* ── 이탈 판정 기준 ───────────────────────────────────────────── */

test('종료하면 이번 경로가 다음 주행의 기준이 된다', async function () {
  const { s, clock, store } = build({ course: { spots: [], path: [] } });
  await s.start();
  for (let i = 0; i <= 30; i++) {
    clock.advance(i === 0 ? 0 : 1000);
    s.onFixes({ error: null, fixes: [fix({ t: T0 + i * 1000, lat: north(3 * i) })] });
  }
  await s.finish('user');
  const path = store.written().path;
  assert(path.length > 1, '경로가 저장되지 않았습니다 (' + path.length + '점)');
  assert(path[0].lat != null && path[0].lon != null, '경로 점 모양이 다릅니다');
});

/* ── 무이동 자동 종료 ─────────────────────────────────────────── */

test('움직임이 없으면 스스로 종료한다', async function () {
  const { s, clock, location } = build();
  await s.start();
  s.onFixes({ error: null, fixes: [fix({ t: T0 })] });
  clock.advance(181000);
  await s.onFixes({ error: null, fixes: [fix({ t: T0 + 181000 })] });
  assert(location.state.running === false, '구독이 살아 있습니다');
  // 끝난 주행은 화면에 남는다. 러너가 결과를 봐야 하므로 지우지 않는다
  assert(s.view().state === 'finished', '주행이 종료되지 않았습니다 (' + s.view().state + ')');
});

/* ── 배경 분배 ────────────────────────────────────────────────── */

function routerSetup() {
  const clock = fakeClock(T0);
  const trace = fakeTrace(); trace.bindClock(clock);
  const session = fakeSession();
  const location = fakeLocation();
  const speech = fakeSpeech();
  const store = fakeStore({ spots: [], path: [] });

  const run = createRunSession({ location, speech, session, store, now: clock.now });
  const diagnostic = createDiagnosticSession({ location, trace, session, now: clock.now, speak: speech.speak });
  const router = createBackgroundRouter({ session, location, trace });
  router.register(RUN, function (p) { return run.onFixes(p); });
  router.register(DIAGNOSTIC, function (p) { return diagnostic.onBackgroundFixes(p); });
  return { router, run, diagnostic, session, location, trace, clock };
}

test('주행이 걸어둔 구독을 진단이 받지 않는다', async function () {
  // 진단은 만료되면 스스로 구독을 끊는다. 주행 구독을 진단이 받으면 달리는 중에 멈춘다
  const { router, run, session, location, clock } = routerSetup();
  await run.start();
  assert(session.read().owner === RUN, '주인이 주행이 아닙니다');

  clock.advance(60000);
  await router.route({ error: null, fixes: [fix({ t: T0 + 60000 })] });

  assert(location.state.running === true, '주행 구독이 끊겼습니다');
  assert(location.state.stopCalls === 0, '해제가 불렸습니다');
  assert(run.view().state === 'running', '주행이 멈췄습니다');
});

test('진단이 걸어둔 구독은 진단이 받는다', async function () {
  const { router, diagnostic, session, trace, clock } = routerSetup();
  await diagnostic.start();
  assert(session.read().owner === DIAGNOSTIC, '주인이 진단이 아닙니다');
  clock.advance(5000);
  await router.route({ error: null, fixes: [fix({ t: T0 + 5000 })] });
  assert(trace.read().some(function (m) { return m.kind === 'bg'; }), '진단이 받지 않았습니다');
});

test('주인 없는 구독은 해제한다', async function () {
  const { router, location } = routerSetup();
  location.state.running = true;   // 기록은 없고 등록만 남은 상태
  await router.route({ error: null, fixes: [fix({ t: T0 })] });
  assert(location.state.running === false, '주인 없는 구독이 살아 있습니다');
});

test('모르는 주인이 적혀 있으면 해제한다', async function () {
  const { router, session, location } = routerSetup();
  session.start(60000, T0, 'ghost');
  location.state.running = true;
  await router.route({ error: null, fixes: [fix({ t: T0 })] });
  assert(location.state.running === false, '모르는 주인의 구독이 살아 있습니다');
  assert(session.read() === null, '세션이 남았습니다');
});

/* ── 실행 ─────────────────────────────────────────────────────── */
let pass = 0, fail = 0;
const t0 = Date.now();
for (const c of cases) {
  try { await c.fn(); pass++; console.log('  ok    ' + c.name); }
  catch (e) { fail++; console.log('  FAIL  ' + c.name + '\n        ' + e.message); }
}
console.log('\n' + pass + ' 통과 · ' + fail + ' 실패 · ' + ((Date.now() - t0) / 1000).toFixed(1) + '초');
process.exit(fail ? 1 : 0);
