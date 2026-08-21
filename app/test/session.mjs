// 달리기 세션과 배경 분배 시험. 기기 없이 돈다.
//
// 잡는 것
//   - 배경 구독을 남의 세션이 받아 끊어버리지 않는가 (달리기 중 측정이 멈추는 결함)
//   - 주인 없는 구독이 남지 않는가 (앱이 계속 깨어나던 결함)
//   - 지정한 지점에서 응원이 나가는가, 이번 달리기에는 울리지 않는가
//   - 종료 뒤 이번 경로가 다음 달리기의 이탈 판정 기준이 되는가
//   - 조작 확인이 말이 아니라 소리로 가는가 (말투가 어색해 짧은 소리로 바꿨다)
//
// 실행: node test/session.mjs

import { createRunSession, OWNER as RUN } from '../src/application/RunSession.js';
import { createDiagnosticSession, OWNER as DIAGNOSTIC } from '../src/application/DiagnosticSession.js';
import { createBackgroundRouter } from '../src/application/BackgroundRouter.js';
import { WAYPOINT_RAD } from '../src/domain/constants.js';
import { fakeClock, fakeTrace, fakeSession, fakeLocation, fakeSpeech, fakeCue, fakeNetwork } from './doubles.mjs';

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

function fakeStore(seed, opts) {
  const o = opts || {};
  let course = seed || {};
  let shelf = o.shelf || {};
  const runs = (o.runs || []).slice();
  return {
    runs,
    readRuns: function () { return runs.slice(); },
    relinkRuns: function (fromId, toId, name) {
      for (let i = 0; i < runs.length; i++) {
        if (runs[i].courseId === fromId || runs[i].courseId === toId) {
          runs[i] = Object.assign({}, runs[i], { courseId: toId, courseName: name || '' });
        }
      }
      return true;
    },
    readCourse: function () { return course; },
    writeCourse: function (c) { course = c; return true; },
    readShelf: function () { return shelf; },
    // 저장 실패를 시험이 만들 수 있어야 한다. 실패를 삼키면 사용자가 만든 코스가 조용히 사라진다
    writeShelf: function (sh) { if (o.failShelf) return false; shelf = sh; return true; },
    appendRun: function (s) { runs.push(s); return true; },
    written: function () { return course; },
    shelf: function () { return shelf; }
  };
}

function build(opts) {
  const o = opts || {};
  const clock = fakeClock(T0);
  const session = fakeSession();
  const location = fakeLocation(o.location);
  const speech = fakeSpeech(o.speech);
  const cue = fakeCue();
  const network = fakeNetwork(o.network);
  const store = fakeStore(o.course, o.store);
  let changes = 0;
  const s = createRunSession({
    location, speech, cue, network, session, store,
    now: clock.now,
    onChange: function () { changes++; }
  });
  return { s, clock, session, location, speech, cue, network, store, changed: function () { return changes; } };
}

/* ── 시작과 종료 ──────────────────────────────────────────────── */

test('배경 권한이 없으면 달리기를 시작하지 않는다', async function () {
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

test('구독 실패하면 달리기를 남기지 않는다', async function () {
  const { s, session } = build({ location: { failStart: true } });
  const r = await s.start();
  assert(r.started === false, '실패했는데 시작으로 봤습니다');
  assert(session.read() === null, '세션이 남았습니다');
  assert(s.view().state === 'ready', '달리기가 남았습니다');
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
  assert(store.runs.length === 1, '달리기 기록이 저장되지 않았습니다');
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

test('여기 표시는 이번 달리기에 울리지 않는다', async function () {
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
    '이번 달리기에서 울렸습니다: ' + JSON.stringify(added));
});

test('위치를 받기 전에는 여기 표시가 되지 않는다', async function () {
  const { s } = build();
  await s.start();
  const r = s.markHere();
  assert(r.marked === false, '위치 없이 표시됐습니다');
  assert(r.reason === 'no-position', '사유가 다릅니다: ' + r.reason);
});

test('여기 표시가 구간을 닫아 기록 달리기에도 구간 페이스가 남는다', async function () {
  const { s, clock } = build({ course: { spots: [], path: [] } });
  await s.start();
  s.onFixes({ error: null, fixes: [fix({ t: T0 })] });
  for (let i = 1; i <= 40; i++) {
    clock.advance(1000);
    s.onFixes({ error: null, fixes: [fix({ t: T0 + i * 1000, lat: north(3 * i) })] });
  }
  s.markHere();
  const v = s.view();
  assert(v.splits.length === 1, '구간 기록이 없습니다');
  assert(v.splits[0].by === 'mark', '닫은 사유가 다릅니다: ' + v.splits[0].by);
  assert(v.splits[0].pace != null, '구간 페이스가 없습니다');
});

test('메인 페이스는 평균이라 지점을 찍어도 그대로다', async function () {
  const { s, clock } = build({ course: { spots: [], path: [] } });
  await s.start();
  s.onFixes({ error: null, fixes: [fix({ t: T0 })] });
  for (let i = 1; i <= 40; i++) {
    clock.advance(1000);
    s.onFixes({ error: null, fixes: [fix({ t: T0 + i * 1000, lat: north(3 * i) })] });
  }
  const before = s.view().pace;
  s.markHere();
  const after = s.view().pace;
  assert(before != null && after === before,
    '지점 표시로 페이스가 바뀌었습니다: ' + before + ' → ' + after);
});

test('진행 중 구간이 실시간으로 나온다', async function () {
  const { s, clock } = build({ course: { spots: [], path: [] } });
  await s.start();
  s.onFixes({ error: null, fixes: [fix({ t: T0 })] });
  for (let i = 1; i <= 10; i++) {
    clock.advance(1000);
    s.onFixes({ error: null, fixes: [fix({ t: T0 + i * 1000, lat: north(3 * i) })] });
  }
  s.markHere();
  for (let i = 11; i <= 15; i++) {
    clock.advance(1000);
    s.onFixes({ error: null, fixes: [fix({ t: T0 + i * 1000, lat: north(3 * i) })] });
  }
  const seg = s.view().seg;
  assert(seg, '진행 중 구간이 없습니다');
  assert(seg.dist < 20, '구간이 표시 자리에서 다시 시작하지 않았습니다: ' + Math.round(seg.dist) + 'm');
});

test('코스별 달리기 기록을 식별자와 이름으로 찾는다', async function () {
  const { s, clock } = build({
    course: { spots: [], path: [] },
    store: { runs: [{ courseId: 'old', courseName: '한강', startedAt: T0 - 86400000, dist: 1000, ms: 300000, pace: 300 }] }
  });
  await s.start();
  s.onFixes({ error: null, fixes: [fix({ t: T0 })] });
  for (let i = 1; i <= 10; i++) {
    clock.advance(1000);
    s.onFixes({ error: null, fixes: [fix({ t: T0 + i * 1000, lat: north(3 * i) })] });
  }
  s.markHere();
  await s.finish('user');
  const byId = s.courseRuns(s.course().id, '');
  assert(byId.length === 1, '식별자로 찾지 못했습니다: ' + byId.length);
  assert((byId[0].splits || []).length === 2, '기록에 구간이 없습니다');
  // 저장하며 식별자가 바뀌어도 이름이 받친다
  assert(s.courseRuns('새 식별자', '한강').length === 1, '이름으로 찾지 못했습니다');
  assert(s.courseRuns('없는 것', '').length === 0, '다른 코스의 기록이 잡혔습니다');
});

// 달리기 하나를 만들어 종료까지 간다. 코스-기록 연결 시험들이 같은 밑그림을 쓴다
async function finishOneRun(s, clock) {
  await s.start();
  s.onFixes({ error: null, fixes: [fix({ t: T0 })] });
  for (let i = 1; i <= 10; i++) {
    clock.advance(1000);
    s.onFixes({ error: null, fixes: [fix({ t: T0 + i * 1000, lat: north(3 * i) })] });
  }
  await s.finish('user');
}

test('이름 붙여 저장하면 그 전 기록도 그 코스의 것이 된다', async function () {
  const { s, clock, store } = build({ course: { spots: [], path: [] } });
  await finishOneRun(s, clock);
  assert(store.runs[0].courseId === 'course', '저장 전 기록의 식별자가 다릅니다: ' + store.runs[0].courseId);

  const r = s.saveCourse('한강길');
  assert(r.ok, '저장 실패: ' + r.reason);
  const runs = s.courseRuns(s.course().id, '');
  assert(runs.length === 1, '저장된 코스에서 기록을 찾지 못했습니다');
  assert(runs[0].courseName === '한강길', '기록의 코스 이름이 이관되지 않았습니다');
  assert(s.view().lastRun.courseId === s.course().id, '마지막 달리기 카드의 연결이 낡았습니다');
});

test('마지막 달리기 칸에서도 기록을 찾는다', async function () {
  const { s, clock } = build({ course: { spots: [], path: [] } });
  await finishOneRun(s, clock);
  const last = s.view().shelf.find(function (c) { return c.slot === 'last'; });
  assert(last, '마지막 칸이 없습니다');
  assert(last.origin !== last.id, '마지막 칸이 코스 식별자를 따로 남기지 않았습니다');
  assert(s.courseRuns(last.origin, last.name).length === 1, '마지막 칸의 기록을 찾지 못했습니다');
});

test('코스를 지워도 기록은 남는다', async function () {
  const { s, clock, store } = build({ course: { spots: [], path: [] } });
  await finishOneRun(s, clock);
  s.saveCourse('한강길');
  const id = s.course().id;
  s.removeCourse(id);
  assert(store.runs.length === 1, '코스를 지우자 기록이 사라졌습니다');
  assert(s.courseRuns(id, '').length === 1, '기록이 남아 있는데 찾지 못했습니다');
});

test('저장된 마지막 달리기가 달리기 전 화면에 실린다', async function () {
  const { s } = build({
    course: { spots: [], path: [{ lat: LAT, lon: LON }, { lat: north(500), lon: LON }] },
    store: { runs: [{ startedAt: T0 - 86400000, dist: 1600, ms: 749000, pace: 468 }] }
  });
  const v = s.view();
  assert(v.state === 'ready', '달리기 전이 아닙니다');
  assert(v.lastRun && v.lastRun.dist === 1600, '마지막 달리기가 실리지 않았습니다');
  assert(v.coursePath.length === 2, '기준 경로가 실리지 않았습니다');
});

test('종료하면 마지막 달리기가 그 자리에서 갱신된다', async function () {
  const { s, clock } = build({ course: { spots: [], path: [] } });
  await s.start();
  s.onFixes({ error: null, fixes: [fix({ t: T0 })] });
  for (let i = 1; i <= 10; i++) {
    clock.advance(1000);
    s.onFixes({ error: null, fixes: [fix({ t: T0 + i * 1000, lat: north(3 * i) })] });
  }
  await s.finish('user');
  const v = s.view();
  assert(v.lastRun && Math.abs(v.lastRun.dist - v.dist) < 1, '마지막 달리기가 갱신되지 않았습니다');
});

test('종료 요약에 구간 목록이 담긴다', async function () {
  const { s, clock, store } = build({ course: { spots: [], path: [] } });
  await s.start();
  s.onFixes({ error: null, fixes: [fix({ t: T0 })] });
  for (let i = 1; i <= 10; i++) {
    clock.advance(1000);
    s.onFixes({ error: null, fixes: [fix({ t: T0 + i * 1000, lat: north(3 * i) })] });
  }
  s.markHere();
  for (let i = 11; i <= 15; i++) {
    clock.advance(1000);
    s.onFixes({ error: null, fixes: [fix({ t: T0 + i * 1000, lat: north(3 * i) })] });
  }
  await s.finish('user');
  assert(store.runs.length === 1, '요약이 저장되지 않았습니다');
  const splits = store.runs[0].splits;
  assert(splits.length === 2, '구간이 2건이 아닙니다: ' + splits.length);
  assert(splits[0].by === 'mark' && splits[1].by === 'finish',
    '구간 사유가 다릅니다: ' + splits.map(function (x) { return x.by; }).join(','));
});

/* ── 시작 조건 ────────────────────────────────────────────────── */

test('위치를 한 건도 못 받으면 시작하지 않는다', async function () {
  // 지하가 이 상태다. 시작을 시도하면 구독을 걸다 실패하고 눌렀다 바로 풀린 것으로 보인다
  const { s, location, session } = build({ location: { noFix: true } });
  const r = await s.start();
  assert(r.started === false, '위치 없이 시작했습니다');
  assert(r.reason === 'not-ready', '사유가 다릅니다: ' + r.reason);
  assert(r.blocks.indexOf('no-fix') >= 0, '사유에 위치가 없습니다: ' + JSON.stringify(r.blocks));
  assert(location.state.startCalls === 0, '구독을 걸었습니다');
  assert(session.read() === null, '세션을 남겼습니다');
});

test('위치 서비스가 꺼져 있으면 그것만 사유로 적는다', async function () {
  // 꺼진 서비스에 위치를 달라고 하면 기다리다 못 받는다. 원인만 적어야 할 일이 하나가 된다
  const { s } = build({ location: { services: false, noFix: true } });
  await s.checkReadiness();
  const v = s.view();
  assert(v.canStart === false, '서비스가 꺼졌는데 시작할 수 있다고 봅니다');
  assert(v.blocks.length === 1 && v.blocks[0] === 'location-service',
    '사유가 하나가 아닙니다: ' + JSON.stringify(v.blocks));
});

test('인터넷이 끊기면 시작하지 않는다', async function () {
  // 거리와 응원은 끊겨도 돌지만 지도를 못 그리면 지점을 찍을 수 없다
  const { s, location } = build({ network: { online: false } });
  const r = await s.start();
  assert(r.started === false, '인터넷 없이 시작했습니다');
  assert(r.blocks.indexOf('offline') >= 0, '사유에 인터넷이 없습니다: ' + JSON.stringify(r.blocks));
  assert(location.state.startCalls === 0, '구독을 걸었습니다');
});

test('상태가 돌아오면 다시 시작할 수 있다', async function () {
  const { s, network } = build({ network: { online: false } });
  await s.checkReadiness();
  assert(s.view().canStart === false, '끊긴 상태에서 시작할 수 있다고 봅니다');

  network.change(true);
  assert(s.view().canStart === true, '연결이 돌아왔는데 여전히 막혀 있습니다: '
    + JSON.stringify(s.view().blocks));

  const r = await s.start();
  assert(r.started === true, '돌아온 뒤에도 시작하지 못했습니다: ' + r.reason);
});

test('달리는 중에 끊겨도 달리기는 멈추지 않는다', async function () {
  // 이미 시작한 달리기를 화면 상태로 끊으면 기록이 사라진다
  const { s, network, clock, location } = build();
  await s.start();
  s.onFixes({ error: null, fixes: [fix({ t: T0 })] });

  network.change(false);
  for (let i = 1; i <= 20; i++) {
    clock.advance(1000);
    s.onFixes({ error: null, fixes: [fix({ t: T0 + i * 1000, lat: north(3 * i) })] });
  }
  const v = s.view();
  assert(v.state === 'running', '끊겼다고 달리기가 멈췄습니다 (' + v.state + ')');
  assert(v.dist > 40, '거리가 쌓이지 않았습니다: ' + Math.round(v.dist) + 'm');
  assert(location.state.running === true, '구독이 끊겼습니다');
  assert(v.blocks.length === 0, '달리는 중에 배너를 띄웁니다: ' + JSON.stringify(v.blocks));
});

test('달리는 중에는 시작 조건을 다시 묻지 않는다', async function () {
  // 배경 구독이 위치를 받고 있는 중에 한 건을 따로 달라고 하면 수신에 끼어든다
  const { s } = build();
  await s.start();
  const before = s.view().state;
  const r = await s.checkReadiness();
  assert(r.running === true, '달리는 중인데 조건을 물었습니다');
  assert(s.view().state === before, '상태가 바뀌었습니다');
});

test('위치를 못 받는 동안에는 지난 자리를 받은 것으로 보지 않는다', async function () {
  // 지난번 값을 돌려주면 지금 못 받는 상태가 받은 것으로 읽힌다
  const clock = fakeClock(T0);
  let noFix = false;
  const location = fakeLocation();
  location.once = async function () { return noFix ? null : { coords: { latitude: LAT, longitude: LON }, timestamp: T0 }; };
  const s = createRunSession({
    location, speech: fakeSpeech(), cue: fakeCue(), network: fakeNetwork(),
    session: fakeSession(), store: fakeStore({ spots: [], path: [] }), now: clock.now
  });
  await s.checkReadiness();
  assert(s.view().canStart === true, '받았는데 막혔습니다');

  noFix = true;
  await s.checkReadiness();
  assert(s.view().canStart === false, '못 받는데 시작할 수 있다고 봅니다');
  assert(s.view().here != null, '지도 자리까지 지웠습니다. 마지막으로 안 자리는 남아야 합니다');
});

/* ── 버튼이 눌리는가 (생애주기 전체) ─────────────────────────────

   결함 둘이 같은 자리에서 났다. 가드를 넣을 때 새로 막으려던 상태만 시험했고,
   이미 되던 상태(첫 실행·종료 직후)는 지나가지 않았다. 그래서 상태마다 두 버튼이
   눌리는지를 표로 고정한다. 되던 것이 깨지면 여기서 걸린다.                        */

// 상태를 만들고 그 상태의 버튼 상태를 돌려준다
const LIFECYCLE = [
  {
    name: '첫 실행. 권한을 아직 묻지 않았고 허용하면 위치가 온다',
    opts: { location: { permissions: { foreground: 'undetermined', background: 'undetermined' }, grantOnAsk: true } },
    async reach(s) { await s.checkReadiness(); },
    want: { canStart: true, canMark: false, canFinish: false, canToggle: true, blocks: [] }
  },
  {
    name: '준비. 권한이 있고 위치도 받았다',
    opts: {},
    async reach(s) { await s.checkReadiness(); },
    want: { canStart: true, canMark: false, canFinish: false, canToggle: true, blocks: [] }
  },
  {
    name: '달리는 중. 위치를 한 건 받았다',
    opts: {},
    async reach(s, clock) {
      await s.start();
      s.onFixes({ error: null, fixes: [fix({ t: T0 })] });
    },
    want: { canStart: false, canMark: true, canFinish: true, canToggle: true, blocks: [] }
  },
  {
    name: '달리는 중인데 위치를 아직 못 받았다',
    opts: {},
    async reach(s) { await s.start(); },
    want: { canStart: false, canMark: false, canFinish: true, canToggle: true, blocks: [] }
  },
  {
    name: '달리는 중에 인터넷이 끊겼다',
    opts: {},
    async reach(s, clock, extra) {
      await s.start();
      s.onFixes({ error: null, fixes: [fix({ t: T0 })] });
      extra.network.change(false);
    },
    want: { canStart: false, canMark: true, canFinish: true, canToggle: true, blocks: [] }
  },
  {
    name: '종료 직후',
    opts: {},
    async reach(s, clock) {
      await s.start();
      s.onFixes({ error: null, fixes: [fix({ t: T0 })] });
      clock.advance(1000);
      await s.finish('user');
    },
    want: { canStart: true, canMark: false, canFinish: false, canToggle: true, blocks: [] }
  },
  {
    name: '권한이 거부됐다',
    opts: { location: { permissions: { foreground: 'denied', background: 'denied' }, noFix: true } },
    async reach(s) { await s.checkReadiness(); },
    want: { canStart: false, canMark: false, canFinish: false, canToggle: false, blocks: ['location-permission'] }
  },
  {
    name: '위치 서비스가 꺼졌다',
    opts: { location: { services: false, noFix: true } },
    async reach(s) { await s.checkReadiness(); },
    want: { canStart: false, canMark: false, canFinish: false, canToggle: false, blocks: ['location-service'] }
  },
  {
    name: '지하. 권한은 있고 위치가 오지 않는다',
    opts: { location: { noFix: true } },
    async reach(s) { await s.checkReadiness(); },
    want: { canStart: false, canMark: false, canFinish: false, canToggle: false, blocks: ['no-fix'] }
  },
  {
    name: '인터넷이 끊긴 채로 시작 전',
    opts: { network: { online: false } },
    async reach(s) { await s.checkReadiness(); },
    want: { canStart: false, canMark: false, canFinish: false, canToggle: false, blocks: ['offline'] }
  }
];

LIFECYCLE.forEach(function (c) {
  test('버튼 상태 — ' + c.name, async function () {
    const built = build(c.opts);
    await c.reach(built.s, built.clock, built);
    const v = built.s.view();
    ['canStart', 'canMark', 'canFinish', 'canToggle'].forEach(function (k) {
      assert(v[k] === c.want[k], k + ' 가 ' + v[k] + ' 입니다 (기대 ' + c.want[k] + ')');
    });
    assert(v.blocks.join(',') === c.want.blocks.join(','),
      '사유가 [' + v.blocks.join(',') + '] 입니다 (기대 [' + c.want.blocks.join(',') + '])');
  });
});

/* ── 종료 뒤 다시 시작 ────────────────────────────────────────── */

test('종료한 뒤에는 다시 시작할 수 있다', async function () {
  // 끝난 달리기는 화면에 남지만 달리는 중은 아니다. 이 구분이 없어서 종료하면
  // 달리기 버튼이 잠긴 채로 남았고, 앱을 다시 켜야 풀렸다
  const { s, clock } = build();
  await s.start();
  s.onFixes({ error: null, fixes: [fix({ t: T0 })] });
  clock.advance(1000);
  await s.finish('user');

  const v = s.view();
  assert(v.state === 'finished', '상태가 ' + v.state + ' 입니다');
  assert(v.canStart === true, '종료 뒤에 시작이 잠겼습니다: ' + JSON.stringify(v.blocks));
  assert(v.blocks.length === 0, '사유가 남았습니다: ' + JSON.stringify(v.blocks));

  clock.advance(1000);
  const again = await s.start();
  assert(again.started === true, '다시 시작하지 못했습니다: ' + again.reason);
  assert(s.view().state === 'running', '상태가 ' + s.view().state + ' 입니다');
});

test('달리는 중에는 시작 조건을 화면에 알리지 않는다', async function () {
  // 배너를 띄워도 할 일이 없고, 달리면서 읽지도 않는다
  const { s } = build();
  await s.start();
  const v = s.view();
  assert(v.canStart === false, '달리는 중에 시작할 수 있다고 봅니다');
  assert(v.blocks.length === 0, '달리는 중에 배너를 띄웁니다: ' + JSON.stringify(v.blocks));
});

test('종료 뒤에는 코스 추천이 다시 보인다', async function () {
  // 달리는 중에만 감춘다. 끝난 뒤에는 다음 달리기를 위해 고를 수 있어야 한다
  const { s, clock } = build({ course: { spots: [], path: [] } });
  await runOnce(s, clock, [20]);
  s.saveCourse('가까운 코스');
  await s.checkReadiness();
  assert(s.view().suggested.length >= 1, '종료 뒤에 추천이 사라졌습니다');
});

/* ── 권한과 시작 조건 ─────────────────────────────────────────── */

// 첫 설치 상태. 권한을 아직 묻지 않았고 그래서 위치도 못 받는다
const FIRST_RUN = {
  location: { permissions: { foreground: 'undetermined', background: 'undetermined' }, noFix: true }
};

test('권한을 아직 묻지 않았으면 달리기를 막지 않는다', async function () {
  // 막으면 권한을 물어볼 경로가 사라진다. 권한 요청은 시작 안에만 있고
  // 시작은 버튼으로만 불리므로, 버튼을 잠그면 새 기기가 그 고리에 갇힌다
  const { s } = build(FIRST_RUN);
  await s.checkReadiness();
  const v = s.view();
  assert(v.canStart === true, '아직 묻지 않았는데 막았습니다: ' + JSON.stringify(v.blocks));
  assert(v.blocks.length === 0, '사유가 남았습니다: ' + JSON.stringify(v.blocks));
});

test('첫 실행에 권한을 스스로 묻는다', async function () {
  // 버튼을 누를 때까지 기다리면 사용자는 왜 안 되는지 모른다
  const { s, location } = build(FIRST_RUN);
  await s.checkReadiness();
  assert(location.state.requestCalls === 1, '묻지 않았습니다 (' + location.state.requestCalls + '번)');
});

test('권한은 두 번 이상 묻지 않는다', async function () {
  // iOS 는 한 번만 대화상자를 띄운다. 거부된 뒤 다시 부르면 조용히 거부가 돌아온다
  const { s, location } = build(FIRST_RUN);
  await s.checkReadiness();
  await s.checkReadiness();
  await s.checkReadiness();
  assert(location.state.requestCalls === 1, '' + location.state.requestCalls + '번 물었습니다');
});

test('첫 실행에 허용하면 그 자리에서 조건이 선다', async function () {
  const { s, location } = build({
    location: { permissions: { foreground: 'undetermined', background: 'undetermined' }, grantOnAsk: true }
  });
  await s.checkReadiness();
  assert(s.view().canStart === true, '허용했는데 막혔습니다: ' + JSON.stringify(s.view().blocks));
  assert(location.state.onceCalls === 1, '허용 뒤에 위치를 묻지 않았습니다');
});

test('막힌 사유를 기기 기록에 남긴다', async function () {
  // 실측에서는 화면을 볼 수 없다. 왜 시작하지 못했는지는 기록으로만 안다
  const clock = fakeClock(T0);
  const trace = fakeTrace(); trace.bindClock(clock);
  const s = createRunSession({
    location: fakeLocation({ permissions: { foreground: 'denied', background: 'denied' }, noFix: true }),
    speech: fakeSpeech(), cue: fakeCue(), network: fakeNetwork(),
    session: fakeSession(), store: fakeStore({ spots: [], path: [] }), trace: trace, now: clock.now
  });
  await s.checkReadiness();
  const lines = trace.read().filter(function (m) { return /시작 조건/.test(m.msg); });
  assert(lines.length === 1, '사유를 남기지 않았습니다');
  assert(/location-permission/.test(lines[0].msg), '사유가 다릅니다: ' + lines[0].msg);

  // 같은 사유를 반복해서 남기지 않는다
  await s.checkReadiness();
  await s.checkReadiness();
  const again = trace.read().filter(function (m) { return /시작 조건/.test(m.msg); });
  assert(again.length === 1, '같은 사유를 ' + again.length + '번 남겼습니다');
});

test('권한을 아직 묻지 않았으면 위치를 묻지 않는다', async function () {
  // 권한 없이 위치를 물으면 호출이 바로 거부된다. 8초를 기다릴 이유가 없다
  const { s, location } = build(FIRST_RUN);
  await s.checkReadiness();
  assert(location.state.onceCalls === 0, '권한 없이 위치를 ' + location.state.onceCalls + '번 물었습니다');
});

test('첫 설치에서 달리기를 누르면 권한을 묻고 시작한다', async function () {
  // 누르는 순간 시스템이 묻는다. 대역은 허용을 돌려주도록 둔다
  const clock = fakeClock(T0);
  const location = fakeLocation({ permissions: { foreground: 'undetermined', background: 'undetermined' } });
  const s = createRunSession({
    location, speech: fakeSpeech(), cue: fakeCue(), network: fakeNetwork(),
    session: fakeSession(), store: fakeStore({ spots: [], path: [] }), now: clock.now
  });
  // 물어보면 허용으로 바뀐다
  location.requestPermissions = async function () {
    location.state.permissions = { foreground: 'granted', background: 'granted' };
    return location.state.permissions;
  };
  await s.checkReadiness();
  assert(s.view().canStart === true, '첫 설치에서 막혔습니다');
  const r = await s.start();
  assert(r.started === true, '권한을 묻고도 시작하지 못했습니다: ' + r.reason);
});

test('권한이 거부되면 막고 설정으로 보낼 사유를 낸다', async function () {
  // 거부는 앱 안에서 되돌릴 수 없다. 지하와 같은 사유로 다루면 엉뚱한 안내가 나간다
  const { s } = build({
    location: { permissions: { foreground: 'denied', background: 'denied' }, noFix: true }
  });
  await s.checkReadiness();
  const v = s.view();
  assert(v.canStart === false, '거부됐는데 시작할 수 있다고 봅니다');
  assert(v.blocks.indexOf('location-permission') >= 0,
    '권한 사유가 없습니다: ' + JSON.stringify(v.blocks));
  assert(v.blocks.indexOf('no-fix') < 0, '지하 사유를 함께 냈습니다: ' + JSON.stringify(v.blocks));
});

test('권한이 거부되면 위치를 묻지 않는다', async function () {
  const { s, location } = build({
    location: { permissions: { foreground: 'denied', background: 'denied' }, noFix: true }
  });
  await s.checkReadiness();
  assert(location.state.onceCalls === 0, '거부 상태에서 위치를 물었습니다');
});

test('배경 권한을 거부하면 그 사실이 조건에 남는다', async function () {
  // 물어본 결과를 반영하지 않으면 버튼이 살아 있어 같은 실패를 반복한다
  const { s } = build({
    location: { permissions: { foreground: 'granted', background: 'denied' } }
  });
  const r = await s.start();
  assert(r.started === false, '배경 권한 없이 시작했습니다');
  assert(r.reason === 'background-permission', '사유가 다릅니다: ' + r.reason);
});

/* ── 조작 확인 소리 ───────────────────────────────────────────── */

test('시작·종료·여기 표시는 말이 아니라 소리로 알린다', async function () {
  // 말투가 어색해서 짧은 소리로 바꿨다. 도달 응원만 말로 남긴다
  const { s, cue, speech, clock } = build({ course: { spots: [], path: [] } });
  await s.start();
  assert(cue.state.plays === 1, '시작에 소리가 나지 않았습니다 (' + cue.state.plays + ')');

  s.onFixes({ error: null, fixes: [fix({ t: T0 })] });
  clock.advance(1000);
  s.onFixes({ error: null, fixes: [fix({ t: T0 + 1000, lat: north(3) })] });
  s.markHere();
  assert(cue.state.plays === 2, '여기 표시에 소리가 나지 않았습니다 (' + cue.state.plays + ')');

  clock.advance(1000);
  await s.finish('user');
  assert(cue.state.plays === 3, '종료에 소리가 나지 않았습니다 (' + cue.state.plays + ')');
  assert(speech.said.length === 0, '조작 확인을 말로 했습니다: ' + JSON.stringify(speech.said));
});

test('스스로 끝난 것은 말로 알린다', async function () {
  // 누르지 않았는데 끝났다. 소리만 나면 무엇이 끝났는지 모른 채로 계속 달린다
  const { s, speech, clock } = build();
  await s.start();
  s.onFixes({ error: null, fixes: [fix({ t: T0 })] });
  clock.advance(181000);
  await s.onFixes({ error: null, fixes: [fix({ t: T0 + 181000 })] });
  assert(speech.said.some(function (t) { return /움직임이 없어/.test(t); }),
    '사유를 말하지 않았습니다: ' + JSON.stringify(speech.said));
});

test('소리를 낼 수 없어도 달리기는 시작된다', async function () {
  // 소리는 조작의 결과를 알리는 것이고 조작 자체가 아니다
  const clock = fakeClock(T0);
  const s = createRunSession({
    location: fakeLocation(), speech: fakeSpeech(), session: fakeSession(),
    store: fakeStore({ spots: [], path: [] }), now: clock.now
  });
  const r = await s.start();
  assert(r.started === true, '알림음 어댑터 없이 시작하지 못했습니다: ' + r.reason);
});

test('지점 도달은 그대로 말로 응원한다', async function () {
  const { s, speech, cue, clock } = build({
    course: { spots: [{ id: 's1', lat: north(100), lon: LON, rad: WAYPOINT_RAD }], path: [] }
  });
  await s.start();
  const beeps = cue.state.plays;
  for (let i = 0; i <= 40; i++) {
    clock.advance(i === 0 ? 0 : 1000);
    s.onFixes({ error: null, fixes: [fix({ t: T0 + i * 1000, lat: north(3 * i) })] });
  }
  assert(speech.said.some(function (t) { return /1번 지점/.test(t); }),
    '도달 응원이 말로 나가지 않았습니다: ' + JSON.stringify(speech.said));
  assert(cue.state.plays === beeps, '도달에 소리를 냈습니다. 응원은 말이어야 합니다');
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

test('지도에서 찍은 지점은 이번 달리기에도 목표가 된다', async function () {
  // 여기 표시와 다르다. 아직 지나지 않은 자리일 수 있으므로 이번 달리기에도 울린다
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
    '이번 달리기에서 울리지 않았습니다: ' + JSON.stringify(added));
});

test('코스가 없으면 지도 지정을 사유와 함께 거절한다', async function () {
  const { s } = build({ course: { spots: [], path: [] } });
  const r = s.pin(north(100), LON);
  assert(r.ok === false, '코스가 없는데 받았습니다');
  assert(r.reason === 'no-course', '사유가 다릅니다: ' + r.reason);
});

test('달리기 전에 위치를 한 번 받아 지도 자리를 잡는다', async function () {
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

/* ── 보관함 ───────────────────────────────────────────────────── */

// 한 번 달려서 경로와 지점이 있는 코스를 만든다. 2회차를 보려면 1회차가 있어야 한다
async function runOnce(s, clock, marks) {
  await s.start();
  for (let i = 0; i <= 60; i++) {
    clock.advance(i === 0 ? 0 : 1000);
    s.onFixes({ error: null, fixes: [fix({ t: T0 + i * 1000, lat: north(3 * i) })] });
    if (marks && marks.indexOf(i) >= 0) s.markHere();
  }
  return s.finish('user');
}

test('마지막 달리기는 저장을 누르지 않아도 보관함에 남는다', async function () {
  const { s, clock, store } = build({ course: { spots: [], path: [] } });
  await runOnce(s, clock, [20, 40]);
  const shelf = store.shelf();
  assert(shelf.last, '마지막 칸이 비었습니다');
  assert(shelf.last.spots.length === 2, '지점이 ' + shelf.last.spots.length + '곳입니다');
  assert(shelf.last.path.length > 1, '경로가 남지 않았습니다');
  const v = s.view();
  assert(v.shelf.length === 1, '목록에 ' + v.shelf.length + '개입니다');
  assert(v.shelf[0].slot === 'last', '칸 종류가 다릅니다: ' + v.shelf[0].slot);
});

test('다시 달리면 마지막 칸만 덮어쓰고 저장한 코스는 남는다', async function () {
  const { s, clock, store } = build({ course: { spots: [], path: [] } });
  await runOnce(s, clock, [20]);
  const saved = s.saveCourse('한강 언덕');
  assert(saved.ok === true, '저장하지 못했습니다: ' + saved.reason);

  await s.clearCourse();
  clock.advance(60000);
  await runOnce(s, clock, [10, 30, 50]);

  const shelf = store.shelf();
  assert(shelf.saved.length === 1, '저장한 코스가 사라졌습니다');
  assert(shelf.saved[0].spots.length === 1, '저장한 코스의 지점이 바뀌었습니다');
  assert(shelf.last.spots.length === 3, '마지막 칸이 덮이지 않았습니다');
});

test('저장 칸이 차면 사유와 한도를 함께 낸다', async function () {
  const { s, clock } = build({ course: { spots: [], path: [] } });
  await runOnce(s, clock, [20]);
  assert(s.saveCourse('가').ok === true, '첫 저장이 막혔습니다');
  await s.clearCourse();
  await runOnce(s, clock, [20]);
  assert(s.saveCourse('나').ok === true, '둘째 저장이 막혔습니다');
  await s.clearCourse();
  await runOnce(s, clock, [20]);
  const third = s.saveCourse('다');
  assert(third.ok === false, '한도를 넘겨 받았습니다');
  assert(third.reason === 'shelf-full', '사유가 다릅니다: ' + third.reason);
  assert(third.limit === 2, '한도가 ' + third.limit + ' 로 옵니다');
  assert(s.view().shelfFull === true, '찬 상태를 화면에 알리지 않습니다');
});

test('보관함에서 하나 지우면 다시 저장할 수 있다', async function () {
  const { s, clock } = build({ course: { spots: [], path: [] } });
  await runOnce(s, clock, [20]);
  const first = s.saveCourse('가');
  await s.clearCourse();
  await runOnce(s, clock, [20]);
  s.saveCourse('나');
  await s.clearCourse();
  await runOnce(s, clock, [20]);
  assert(s.saveCourse('다').ok === false, '찬 상태가 아닙니다');

  assert(s.removeCourse(first.course.id) === true, '지우지 못했습니다');
  assert(s.saveCourse('다').ok === true, '지웠는데 저장하지 못했습니다');
});

test('저장 실패를 성공으로 보고하지 않는다', async function () {
  const { s, clock } = build({ course: { spots: [], path: [] }, store: { failShelf: true } });
  await runOnce(s, clock, [20]);
  const r = s.saveCourse('가');
  assert(r.ok === false, '쓰기가 실패했는데 성공으로 봤습니다');
  assert(r.reason === 'write-failed', '사유가 다릅니다: ' + r.reason);
});

test('불러오면 그 코스의 지점과 순서가 지금 코스가 된다', async function () {
  const { s, clock } = build({ course: { spots: [], path: [] } });
  await runOnce(s, clock, [10, 30, 50]);
  const saved = s.saveCourse('세 곳');
  const ids = s.view().spots.map(function (p) { return p.id; }).join(',');

  await s.clearCourse();
  assert(s.view().spots.length === 0, '코스가 비워지지 않았습니다');

  const r = s.loadCourse(saved.course.id);
  assert(r.ok === true, '불러오지 못했습니다: ' + r.reason);
  const back = s.view();
  assert(back.spots.length === 3, '지점이 ' + back.spots.length + '곳입니다');
  assert(back.spots.map(function (p) { return p.id; }).join(',') === ids, '순서가 바뀌었습니다');
  assert(back.hasCourse === true, '기준 경로가 오지 않았습니다');
  assert(back.courseName === '세 곳', '이름이 오지 않았습니다: ' + back.courseName);
});

test('불러온 코스로 달리면 그 순서로 응원한다', async function () {
  const { s, clock, speech } = build({ course: { spots: [], path: [] } });
  await runOnce(s, clock, [10, 30]);
  const saved = s.saveCourse('두 곳');
  await s.clearCourse();
  s.loadCourse(saved.course.id);

  clock.advance(60000);
  await s.start();
  const before = speech.said.length;
  for (let i = 0; i <= 60; i++) {
    clock.advance(i === 0 ? 0 : 1000);
    s.onFixes({ error: null, fixes: [fix({ t: T0 + 120000 + i * 1000, lat: north(3 * i) })] });
  }
  const said = speech.said.slice(before).filter(function (t) { return /번 지점/.test(t); });
  assert(said.length === 2, '응원이 ' + said.length + '번 나갔습니다: ' + JSON.stringify(said));
  assert(/1번 지점/.test(said[0]) && /2번 지점/.test(said[1]), '순서가 다릅니다: ' + JSON.stringify(said));
});

test('불러온 코스를 고쳐도 보관함은 그대로다', async function () {
  const { s, clock, store } = build({ course: { spots: [], path: [] } });
  await runOnce(s, clock, [10, 30]);
  const saved = s.saveCourse('두 곳');
  await s.clearCourse();
  s.loadCourse(saved.course.id);

  const first = s.view().spots[0];
  s.removeSpot(first.id);
  assert(s.view().spots.length === 1, '지금 코스에서 지워지지 않았습니다');
  const kept = store.shelf().saved.find(function (c) { return c.id === saved.course.id; });
  assert(kept.spots.length === 2, '보관함의 코스도 함께 지워졌습니다');
});

test('달리는 중에는 코스를 바꾸지 않는다', async function () {
  const { s, clock } = build({ course: { spots: [], path: [] } });
  await runOnce(s, clock, [20]);
  const saved = s.saveCourse('가');
  clock.advance(60000);
  await s.start();
  const r = s.loadCourse(saved.course.id);
  assert(r.ok === false, '달리는 중에 코스를 갈았습니다');
  assert(r.reason === 'running', '사유가 다릅니다: ' + r.reason);
  assert(s.clearCourse() === false, '달리는 중에 코스를 비웠습니다');
});

test('시작 자리가 근처면 그 코스를 추천한다', async function () {
  const { s, clock } = build({ course: { spots: [], path: [] } });
  await runOnce(s, clock, [20]);
  s.saveCourse('여기');
  await s.clearCourse();

  await s.checkReadiness();   // 위치를 받는다. 대역은 시작점 자리를 준다
  const list = s.view().suggested;
  assert(list.length >= 1, '근처인데 추천이 없습니다');
  assert(list[0].away <= 50, '먼 코스를 권했습니다: ' + Math.round(list[0].away) + 'm');
});

test('먼 자리에서는 추천하지 않는다', async function () {
  const { s, clock } = build({
    course: { spots: [], path: [] },
    location: { at: { lat: north(3000) } }
  });
  await runOnce(s, clock, [20]);
  s.saveCourse('멀리 있는 시작점');
  await s.clearCourse();
  await s.checkReadiness();
  assert(s.view().suggested.length === 0, '먼데 추천했습니다');
});

test('지금 달리는 코스는 추천하지 않는다', async function () {
  const { s, clock } = build({ course: { spots: [], path: [] } });
  await runOnce(s, clock, [20]);
  const saved = s.saveCourse('가');
  s.loadCourse(saved.course.id);
  await s.checkReadiness();
  const mine = s.view().suggested.filter(function (c) { return c.id === saved.course.id; });
  assert(mine.length === 1 && mine[0].current === true,
    '지금 코스인지가 표시되지 않습니다: ' + JSON.stringify(mine));
});

/* ── 이탈 판정 기준 ───────────────────────────────────────────── */

test('종료하면 이번 경로가 다음 달리기의 기준이 된다', async function () {
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
  // 끝난 달리기는 화면에 남는다. 러너가 결과를 봐야 하므로 지우지 않는다
  assert(s.view().state === 'finished', '달리기가 종료되지 않았습니다 (' + s.view().state + ')');
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

test('달리기가 걸어둔 구독을 진단이 받지 않는다', async function () {
  // 진단은 만료되면 스스로 구독을 끊는다. 달리기 구독을 진단이 받으면 달리는 중에 멈춘다
  const { router, run, session, location, clock } = routerSetup();
  await run.start();
  assert(session.read().owner === RUN, '주인이 달리기가 아닙니다');

  clock.advance(60000);
  await router.route({ error: null, fixes: [fix({ t: T0 + 60000 })] });

  assert(location.state.running === true, '달리기 구독이 끊겼습니다');
  assert(location.state.stopCalls === 0, '해제가 불렸습니다');
  assert(run.view().state === 'running', '달리기가 멈췄습니다');
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
