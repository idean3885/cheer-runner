// 도메인 시험. 화면도 플랫폼도 기기도 없다.
//
// 웹 프로토타입에서 브라우저를 띄워 25초 걸려 확인했던 것들이다. 같은 판정을
// 여기서 즉시 낸다. 옮긴 이유는 속도가 아니라 자리다. 브라우저를 띄워야 확인되는
// 판정은 그 로직이 화면에 붙어 있다는 뜻이었다.
//
// 실행: node test/domain.mjs

import * as Run from '../src/domain/Run.js';
import * as Track from '../src/domain/Track.js';
import * as Course from '../src/domain/Course.js';
import * as Shelf from '../src/domain/Shelf.js';
import { haversine, paceOf, distanceToPath } from '../src/domain/geo.js';
import { ACC_CUT, SPEED_MAX, GAP_S, WAYPOINT_RAD, COURSE_TOL, SAVED_MAX } from '../src/domain/constants.js';

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function near(a, b, tol, what) {
  assert(Math.abs(a - b) <= tol, what + ': ' + a.toFixed(1) + ' 이 ' + b.toFixed(1) + ' 에서 ' + tol + ' 넘게 벗어남');
}

const T0 = 1_700_000_000_000;
const LAT = 37.5665, LON = 126.978;

// 정북으로 m 만큼 간 위도. 경도를 건드리지 않아 계산이 단순해진다
function north(m) { return LAT + (m / 6371000) * 180 / Math.PI; }

function fix(spec) {
  const s = spec || {};
  return {
    coords: {
      latitude: s.lat != null ? s.lat : LAT,
      longitude: s.lon != null ? s.lon : LON,
      accuracy: 'acc' in s ? s.acc : 5,
      speed: 'speed' in s ? s.speed : null,
      altitude: null, heading: null
    },
    timestamp: s.t
  };
}

/* ── 측정한다 ─────────────────────────────────────────────────── */

test('일정 속도로 달리면 거리는 속도 적분과 맞는다', function () {
  const run = Run.createRun({});
  Run.start(run, T0);
  // 3 m/s 로 60초. 좌표도 같이 옮겨 도플러와 차분이 어긋나지 않게 둔다
  for (let i = 0; i <= 60; i++) {
    Run.accept(run, fix({ t: T0 + i * 1000, lat: north(3 * i), speed: 3 }));
  }
  near(run.track.dist, 180, 5, '거리');
  near(Run.summary(run).pace, 1000 / 3, 10, '평균 페이스');
});

test('정확도가 컷을 넘는 위치는 거리에 넣지 않는다', function () {
  const run = Run.createRun({});
  Run.start(run, T0);
  Run.accept(run, fix({ t: T0, speed: 3 }));
  const r = Run.accept(run, fix({ t: T0 + 1000, lat: north(3), speed: 3, acc: ACC_CUT + 1 }));
  assert(r.added === 0, '정확도 컷을 넘겼는데 ' + r.added + 'm 를 넣었습니다');
  assert(run.track.dist === 0, '거리가 늘었습니다');
});

test('정확도 컷은 도플러 속도보다 먼저 본다', function () {
  // 오차 200m 인 위치는 속도도 믿을 수 없다. 속도가 있다는 이유로 통과시키면 안 된다
  const run = Run.createRun({});
  Run.start(run, T0);
  Run.accept(run, fix({ t: T0, speed: 3 }));
  const r = Run.accept(run, fix({ t: T0 + 1000, lat: north(3), speed: 3, acc: 200 }));
  assert(r.added === 0, '속도가 있어서 통과시켰습니다');
});

test('사람이 낼 수 없는 속도는 버린다', function () {
  const run = Run.createRun({});
  Run.start(run, T0);
  Run.accept(run, fix({ t: T0 }));
  const r = Run.accept(run, fix({ t: T0 + 1000, lat: north(SPEED_MAX + 5) }));
  assert(r.added === 0, '상한을 넘는 증분 ' + r.added + 'm 를 넣었습니다');
});

test('도플러 속도가 없으면 좌표 차분으로 떨어진다', function () {
  const run = Run.createRun({});
  Run.start(run, T0);
  Run.accept(run, fix({ t: T0 }));
  Run.accept(run, fix({ t: T0 + 1000, lat: north(3) }));
  near(run.track.dist, 3, 0.5, '차분 거리');
  assert(run.track.geoFixes === 1, '차분으로 세지 않았습니다');
  assert(run.track.speedFixes === 0, '속도로 셌습니다');
});

test('거리는 감소하지 않는다', function () {
  const run = Run.createRun({});
  Run.start(run, T0);
  let prev = 0;
  for (let i = 0; i <= 30; i++) {
    // 뒤로 가는 좌표와 정확도가 나쁜 위치를 섞는다
    Run.accept(run, fix({
      t: T0 + i * 1000,
      lat: north(i % 3 === 0 ? -5 * i : 3 * i),
      acc: i % 5 === 0 ? 90 : 5
    }));
    assert(run.track.dist >= prev, i + '번째에서 거리가 줄었습니다');
    prev = run.track.dist;
  }
});

test('같은 시각의 위치는 버린다', function () {
  const run = Run.createRun({});
  Run.start(run, T0);
  Run.accept(run, fix({ t: T0 }));
  const r = Run.accept(run, fix({ t: T0, lat: north(50) }));
  assert(r.added === 0, '같은 시각인데 거리를 넣었습니다');
});

test('시각이 없는 위치는 받지 않는다', function () {
  const run = Run.createRun({});
  Run.start(run, T0);
  const r = Run.accept(run, { coords: { latitude: LAT, longitude: LON, accuracy: 5, speed: null } });
  assert(r.accepted === false, '시각 없이 받았습니다');
  assert(r.reason === 'no-timestamp', '사유가 다릅니다: ' + r.reason);
});

/* ── 결손 ─────────────────────────────────────────────────────── */

test('끊긴 구간은 결손으로 표시하고 선을 끊는다', function () {
  const run = Run.createRun({});
  Run.start(run, T0);
  for (let i = 0; i < 5; i++) Run.accept(run, fix({ t: T0 + i * 1000, lat: north(3 * i), speed: 3 }));
  const gapAt = T0 + 5000 + GAP_S * 1000;
  const r = Run.accept(run, fix({ t: gapAt, lat: north(100), speed: 3 }));
  assert(r.gap === true, '결손으로 보지 않았습니다');
  assert(run.track.gaps.length === 1, '결손 자리를 남기지 않았습니다');
  // 공백 뒤에도 계속 달린다. 그때 선이 둘로 나뉘어야 한다.
  // 표시용 점은 5m 간격으로 솎이므로 그보다 멀리 간 위치를 넣는다
  Run.accept(run, fix({ t: gapAt + 4000, lat: north(112), speed: 3 }));
  const segs = Track.segments(run.track);
  assert(segs.length === 2, '선이 끊기지 않았습니다 (' + segs.length + '조각)');
  const tail = segs[0][segs[0].length - 1];
  assert(tail.dist < 100, '공백 앞 조각이 공백 뒤 점을 물고 있습니다');
});

test('공백을 담은 틱은 창 페이스에서 뺀다', function () {
  // 선행 검증에서 652초를 담은 틱 하나가 창 평균을 망가뜨렸다
  const run = Run.createRun({});
  Run.start(run, T0);
  let t = T0, m = 0;
  Run.accept(run, fix({ t: t, speed: 3 }));
  // 정상 틱 셋
  for (let i = 0; i < 3; i++) {
    t += 11000; m += 33;
    Run.accept(run, fix({ t: t, lat: north(m), speed: 3 }));
  }
  assert(Track.windowPace(run.track) != null, '정상 창에서 페이스가 없습니다');
  // 긴 공백 하나
  t += 652000; m += 10;
  Run.accept(run, fix({ t: t, lat: north(m), speed: 3 }));
  assert(Track.windowPace(run.track) === null, '공백 틱이 창에 들어갔습니다');
});

/* ── 응원받는다 ───────────────────────────────────────────────── */

test('지점에 닿으면 구간이 닫히고 응원 대상이 된다', function () {
  const run = Run.createRun({ spots: [{ id: 's1', lat: north(100), lon: LON, rad: WAYPOINT_RAD }] });
  Run.start(run, T0);
  Run.accept(run, fix({ t: T0, speed: 3 }));
  let hit = null;
  for (let i = 1; i <= 40; i++) {
    const r = Run.accept(run, fix({ t: T0 + i * 1000, lat: north(3 * i), speed: 3 }));
    if (r.arrival) { hit = r.arrival; break; }
  }
  assert(hit, '지점에 닿았는데 도달로 보지 않았습니다');
  assert(hit.idx === 0, '지점 번호가 다릅니다');
  assert(hit.isLast === true, '마지막 지점으로 보지 않았습니다');
  assert(hit.pace != null, '구간 페이스가 없습니다');
  assert(Run.currentTarget(run) === null, '목표가 남았습니다');
});

test('반경 밖에서는 도달로 보지 않는다', function () {
  const run = Run.createRun({ spots: [{ id: 's1', lat: north(1000), lon: LON, rad: WAYPOINT_RAD }] });
  Run.start(run, T0);
  Run.accept(run, fix({ t: T0, speed: 3 }));
  const r = Run.accept(run, fix({ t: T0 + 1000, lat: north(3), speed: 3 }));
  assert(r.arrival === null, '반경 밖인데 도달로 봤습니다');
  assert(Run.distanceToTarget(run, north(3), LON) > WAYPOINT_RAD, '남은 거리가 반경 안입니다');
});

test('지점은 순서대로 하나씩 목표가 된다', function () {
  const run = Run.createRun({
    spots: [
      { id: 's1', lat: north(50), lon: LON, rad: WAYPOINT_RAD },
      { id: 's2', lat: north(200), lon: LON, rad: WAYPOINT_RAD }
    ]
  });
  Run.start(run, T0);
  Run.accept(run, fix({ t: T0, speed: 3 }));
  const order = [];
  for (let i = 1; i <= 80; i++) {
    const r = Run.accept(run, fix({ t: T0 + i * 1000, lat: north(3 * i), speed: 3 }));
    if (r.arrival) order.push(r.arrival.idx);
  }
  assert(order.join(',') === '0,1', '도달 순서가 다릅니다: ' + order.join(','));
  assert(run.arrivals.length === 2, '도달 기록이 2건이 아닙니다');
});

/* ── 구간 ─────────────────────────────────────────────────────── */

test('달리며 지점을 표시하면 그 자리에서 구간이 닫힌다', function () {
  const run = Run.createRun({ spots: [] });
  Run.start(run, T0);
  Run.accept(run, fix({ t: T0, speed: 3 }));
  for (let i = 1; i <= 10; i++) Run.accept(run, fix({ t: T0 + i * 1000, lat: north(3 * i), speed: 3 }));
  const split = Run.passSpot(run, 0);
  assert(split, '구간이 닫히지 않았습니다');
  assert(split.by === 'mark', '닫은 사유가 다릅니다: ' + split.by);
  near(split.segDist, 30, 2, '구간 거리');
  assert(split.pace != null, '구간 페이스가 없습니다');
  assert(run.splits.length === 1, '구간 기록이 1건이 아닙니다');
});

test('지점 표시는 평균 페이스를 재설정하지 않는다', function () {
  // 같은 궤적을 하나는 표시 없이, 하나는 중간에 표시하며 달린다. 평균은 같아야 한다
  const plain = Run.createRun({ spots: [] });
  const marked = Run.createRun({ spots: [] });
  [plain, marked].forEach(function (run) {
    Run.start(run, T0);
    Run.accept(run, fix({ t: T0, speed: 3 }));
    for (let i = 1; i <= 20; i++) {
      Run.accept(run, fix({ t: T0 + i * 1000, lat: north(3 * i), speed: 3 }));
      if (run === marked && i === 10) Run.passSpot(run, 0);
    }
  });
  const at = T0 + 20000;
  near(Track.averagePace(marked.track, at), Track.averagePace(plain.track, at), 0.01, '평균 페이스');
});

test('진행 중 구간은 마지막으로 닫힌 자리부터다', function () {
  const run = Run.createRun({ spots: [] });
  Run.start(run, T0);
  Run.accept(run, fix({ t: T0, speed: 3 }));
  for (let i = 1; i <= 10; i++) Run.accept(run, fix({ t: T0 + i * 1000, lat: north(3 * i), speed: 3 }));
  Run.passSpot(run, 0);
  for (let i = 11; i <= 15; i++) Run.accept(run, fix({ t: T0 + i * 1000, lat: north(3 * i), speed: 3 }));
  const seg = Run.currentSegment(run, T0 + 15000);
  assert(seg, '진행 중 구간이 없습니다');
  near(seg.dist, 15, 2, '진행 구간 거리');
  assert(seg.ms === 5000, '진행 구간 시간이 다릅니다: ' + seg.ms);
});

test('도달도 구간 기록에 남는다', function () {
  const run = Run.createRun({ spots: [{ id: 's1', lat: north(100), lon: LON, rad: WAYPOINT_RAD }] });
  Run.start(run, T0);
  Run.accept(run, fix({ t: T0, speed: 3 }));
  for (let i = 1; i <= 40; i++) Run.accept(run, fix({ t: T0 + i * 1000, lat: north(3 * i), speed: 3 }));
  assert(run.splits.length === 1, '도달이 구간으로 남지 않았습니다');
  assert(run.splits[0].by === 'arrive', '닫은 사유가 다릅니다: ' + run.splits[0].by);
  assert(run.splits[0].segDist === run.arrivals[0].segDist, '도달 기록과 구간 기록의 거리가 다릅니다');
});

test('종료는 닫힌 구간이 있으면 잔여 구간을 닫는다', function () {
  const run = Run.createRun({ spots: [] });
  Run.start(run, T0);
  Run.accept(run, fix({ t: T0, speed: 3 }));
  for (let i = 1; i <= 10; i++) Run.accept(run, fix({ t: T0 + i * 1000, lat: north(3 * i), speed: 3 }));
  Run.passSpot(run, 0);
  for (let i = 11; i <= 15; i++) Run.accept(run, fix({ t: T0 + i * 1000, lat: north(3 * i), speed: 3 }));
  const done = Run.finish(run, T0 + 15000);
  assert(done.summary.splits.length === 2, '구간이 2건이 아닙니다: ' + done.summary.splits.length);
  const last = done.summary.splits[1];
  assert(last.by === 'finish', '마지막 구간의 사유가 다릅니다: ' + last.by);
  near(last.segDist, 15, 2, '잔여 구간 거리');
});

test('지점이 없던 달리기는 종료에 구간을 만들지 않는다', function () {
  // 구간 하나가 전체와 같으면 같은 것을 두 번 적는 셈이다
  const run = Run.createRun({ spots: [] });
  Run.start(run, T0);
  Run.accept(run, fix({ t: T0, speed: 3 }));
  Run.accept(run, fix({ t: T0 + 1000, lat: north(3), speed: 3 }));
  const done = Run.finish(run, T0 + 2000);
  assert(done.summary.splits.length === 0, '구간이 생겼습니다: ' + done.summary.splits.length);
});

/* ── 상태 전이 ────────────────────────────────────────────────── */

test('종료된 달리기는 위치를 받지 않는다', function () {
  const run = Run.createRun({});
  Run.start(run, T0);
  Run.accept(run, fix({ t: T0, speed: 3 }));
  Run.accept(run, fix({ t: T0 + 1000, lat: north(3), speed: 3 }));
  const before = run.track.dist;
  Run.finish(run, T0 + 2000);
  const r = Run.accept(run, fix({ t: T0 + 3000, lat: north(100), speed: 3 }));
  assert(r.accepted === false, '종료된 달리기가 위치를 받았습니다');
  assert(run.track.dist === before, '거리가 늘었습니다');
});

test('시작하지 않은 달리기는 위치를 받지 않는다', function () {
  const run = Run.createRun({});
  const r = Run.accept(run, fix({ t: T0 }));
  assert(r.accepted === false, '시작 전에 위치를 받았습니다');
});

test('두 번 시작하지 않는다', function () {
  const run = Run.createRun({});
  Run.start(run, T0);
  const r = Run.start(run, T0 + 5000);
  assert(r.started === false, '두 번 시작됐습니다');
  assert(run.startedAt === T0, '시작 시각이 덮였습니다');
});

test('움직임이 없으면 스스로 끝낼 상태가 된다', function () {
  const run = Run.createRun({});
  Run.start(run, T0);
  Run.accept(run, fix({ t: T0 }));
  assert(Run.isIdle(run, T0 + 179000) === false, '3분 전에 무이동으로 봤습니다');
  assert(Run.isIdle(run, T0 + 181000) === true, '3분 지났는데 무이동으로 보지 않았습니다');
});

test('제자리에서 위치가 계속 와도 무이동으로 본다', function () {
  // 거리 필터를 0 으로 두었으므로 제자리에서도 위치는 계속 들어온다.
  // 수신을 움직임으로 세면 러너가 멈춰 서 있어도 달리기가 끝나지 않는다
  const run = Run.createRun({});
  Run.start(run, T0);
  for (let i = 0; i <= 200; i++) {
    Run.accept(run, fix({ t: T0 + i * 1000, speed: 0 }));   // 같은 자리, 속도 0
  }
  assert(Run.isIdle(run, T0 + 200000) === true, '제자리인데 움직인 것으로 봤습니다');
});

test('움직이면 무이동 시계가 다시 시작한다', function () {
  const run = Run.createRun({});
  Run.start(run, T0);
  Run.accept(run, fix({ t: T0, speed: 3 }));
  Run.accept(run, fix({ t: T0 + 170000, lat: north(15), speed: 3 }));
  assert(Run.isIdle(run, T0 + 175000) === false, '움직였는데 무이동으로 봤습니다');
  assert(Run.isIdle(run, T0 + 351000) === true, '그 뒤 3분이 지났는데 무이동이 아닙니다');
});

/* ── 지정한다 ─────────────────────────────────────────────────── */

test('달리며 여기를 표시하면 이번 달리기에는 울리지 않는다', function () {
  // 방금 지난 자리라 바로 도달 판정에 걸리면 출발 직후 응원이 나간다
  const course = Course.createCourse({ path: [{ lat: LAT, lon: LON }, { lat: north(500), lon: LON }] });
  const run = Run.createRun({ spots: [] });
  Run.start(run, T0);
  Run.accept(run, fix({ t: T0, speed: 3 }));
  const spot = Course.markHere(course, north(3), LON);
  assert(spot.rad === WAYPOINT_RAD, '반경이 기본값이 아닙니다');
  assert(course.spots.length === 1, '지점이 코스에 남지 않았습니다');
  const r = Run.accept(run, fix({ t: T0 + 1000, lat: north(3), speed: 3 }));
  assert(r.arrival === null, '이번 달리기에서 울렸습니다');
});

test('코스를 벗어난 자리는 지정을 거부한다', function () {
  const course = Course.createCourse({ path: [{ lat: LAT, lon: LON }, { lat: north(500), lon: LON }] });
  const far = Course.pin(course, north(250) + 0.01, LON);   // 경로에서 약 1.1km 옆
  assert(far.ok === false, '코스를 벗어났는데 지정됐습니다');
  assert(far.reason === 'off-course', '사유가 다릅니다: ' + far.reason);
  assert(far.distance > COURSE_TOL, '거리가 한계 안입니다');
  assert(course.spots.length === 0, '거부했는데 지점이 남았습니다');
});

test('코스 위 자리는 지정을 받는다', function () {
  const course = Course.createCourse({ path: [{ lat: LAT, lon: LON }, { lat: north(500), lon: LON }] });
  const ok = Course.pin(course, north(250), LON);
  assert(ok.ok === true, '경로 위인데 거부했습니다');
  assert(course.spots.length === 1, '지점이 남지 않았습니다');
  assert(ok.spot.id !== undefined, '지점에 이름이 없습니다');
});

test('한계와 반경이 같으므로 지정된 지점은 반드시 도달한다', function () {
  // 이 등식이 깨지면 지정은 되는데 영원히 닿지 않는 지점이 생긴다
  assert(COURSE_TOL === WAYPOINT_RAD, '한계와 반경이 다릅니다');
  const course = Course.createCourse({ path: [{ lat: LAT, lon: LON }, { lat: north(500), lon: LON }] });
  // 한계에 딱 걸친 자리를 지정하고, 경로를 그대로 달려 닿는지 본다
  const edge = north(250) + (COURSE_TOL / 6371000) * 180 / Math.PI * 0.99;
  const res = Course.pin(course, edge, LON);
  assert(res.ok === true, '한계 안인데 거부했습니다');

  const run = Run.createRun({ spots: course.spots });
  Run.start(run, T0);
  Run.accept(run, fix({ t: T0, speed: 3 }));
  let hit = false;
  for (let i = 1; i <= 120 && !hit; i++) {
    const r = Run.accept(run, fix({ t: T0 + i * 1000, lat: north(3 * i), speed: 3 }));
    if (r.arrival) hit = true;
  }
  assert(hit, '한계 안에 지정된 지점에 도달하지 못했습니다');
});

test('기준 경로가 없으면 지도에서 지정할 수 없다', function () {
  // 벗어날 기준이 없으면 불변식을 지킬 수 없다. 한 번 달린 뒤에 지정한다
  const course = Course.createCourse({ path: [] });
  const r = Course.pin(course, north(100), LON);
  assert(r.ok === false, '경로가 없는데 받았습니다');
  assert(r.reason === 'no-course', '사유가 다릅니다: ' + r.reason);
  assert(course.spots.length === 0, '거절했는데 지점이 남았습니다');
});

test('지점을 지운다', function () {
  const course = Course.createCourse({ path: [{ lat: LAT, lon: LON }] });
  const s = Course.markHere(course, LAT, LON);
  assert(Course.remove(course, s.id) === true, '지우지 못했습니다');
  assert(course.spots.length === 0, '지점이 남았습니다');
  assert(Course.remove(course, s.id) === false, '없는 지점을 지웠다고 합니다');
});

test('지점 이름은 겹치지 않는다', function () {
  const course = Course.createCourse({ path: [{ lat: LAT, lon: LON }] });
  const a = Course.markHere(course, LAT, LON);
  const b = Course.markHere(course, LAT, LON);
  Course.remove(course, a.id);
  const c = Course.markHere(course, LAT, LON);
  assert(new Set([a.id, b.id, c.id]).size === 3, '이름이 겹쳤습니다: ' + [a.id, b.id, c.id].join(','));
});

test('끝난 달리기의 경로 점을 지점으로 올린다', function () {
  const run = Run.createRun({});
  Run.start(run, T0);
  for (let i = 0; i <= 60; i++) {
    Run.accept(run, fix({ t: T0 + i * 1000, lat: north(3 * i), speed: 3 }));
  }
  Run.finish(run, T0 + 61000);
  const cand = Course.promotionCandidates(run.track);
  assert(cand.length >= 2, '승격 후보가 너무 적습니다 (' + cand.length + ')');
  // 100m 간격으로 솎였는지
  for (let i = 1; i < cand.length; i++) {
    assert(cand[i].dist - cand[i - 1].dist >= 100, '간격이 100m 보다 좁습니다');
  }
  const course = Course.createCourse({ path: run.track.points });
  Course.promote(course, cand[1]);
  assert(course.spots.length === 1, '승격된 지점이 없습니다');
});

/* ── 계산 ─────────────────────────────────────────────────────── */

test('거리가 0 이면 페이스는 없음이다', function () {
  assert(paceOf(0, 60000) === null, '0 거리에서 값이 나왔습니다');
  assert(paceOf(100, 0) === null, '0 시간에서 값이 나왔습니다');
});

test('경로까지의 거리는 선분 위로 잰다', function () {
  // 점과 점 사이 어디든 러너가 지난 자리다. 끝점까지만 재면 중간이 이탈로 잡힌다
  const path = [{ lat: LAT, lon: LON }, { lat: north(1000), lon: LON }];
  const mid = distanceToPath(north(500), LON, path);
  assert(mid < 1, '선분 위 점이 ' + mid.toFixed(1) + 'm 떨어졌다고 나옵니다');
  const endOnly = Math.min(haversine(north(500), LON, LAT, LON), haversine(north(500), LON, north(1000), LON));
  assert(endOnly > 400, '견줄 값이 잘못 잡혔습니다');
});

/* ── 보관함 ───────────────────────────────────────────────────── */

function courseWith(spec) {
  const s = spec || {};
  return Course.createCourse({
    id: s.id || 'course',
    name: s.name || '',
    path: s.path || [{ lat: LAT, lon: LON }, { lat: north(500), lon: LON }],
    spots: s.spots || [{ id: 's1', lat: north(100), lon: LON, rad: WAYPOINT_RAD }]
  });
}

test('마지막 칸은 달릴 때마다 덮어쓴다', function () {
  const shelf = Shelf.createShelf({});
  Shelf.keepLast(shelf, courseWith({ spots: [] }), T0);
  Shelf.keepLast(shelf, courseWith({}), T0 + 1000);
  assert(shelf.last.spots.length === 1, '덮어쓰지 않았습니다');
  assert(shelf.saved.length === 0, '마지막 칸이 저장 칸을 먹었습니다');
});

test('저장 칸이 차면 거절한다', function () {
  // 가장 오래된 것을 내보내지 않는다. 사용자가 이름 붙여 넣은 것이라 조용히 사라지면 안 된다
  const shelf = Shelf.createShelf({});
  assert(Shelf.save(shelf, courseWith({ id: 'course' }), '가', T0).ok === true, '첫 저장이 막혔습니다');
  assert(Shelf.save(shelf, courseWith({ id: 'course' }), '나', T0).ok === true, '둘째 저장이 막혔습니다');
  const third = Shelf.save(shelf, courseWith({ id: 'course' }), '다', T0);
  assert(third.ok === false, '한도를 넘겨 받았습니다');
  assert(third.reason === 'shelf-full', '사유가 다릅니다: ' + third.reason);
  assert(shelf.saved.length === SAVED_MAX, '칸 수가 ' + shelf.saved.length + ' 입니다');
  assert(shelf.saved[0].name === '가', '가장 오래된 것이 사라졌습니다');
});

test('지우면 다시 저장할 수 있다', function () {
  const shelf = Shelf.createShelf({});
  Shelf.save(shelf, courseWith({ id: 'course' }), '가', T0);
  const second = Shelf.save(shelf, courseWith({ id: 'course' }), '나', T0);
  assert(Shelf.remove(shelf, second.course.id) === true, '지우지 못했습니다');
  assert(Shelf.save(shelf, courseWith({ id: 'course' }), '다', T0).ok === true, '지웠는데 막혔습니다');
});

test('이미 보관함에 있는 코스는 그 자리를 갱신한다', function () {
  // 새로 넣는 것으로 보면 불러와 지점 하나 더 찍는 것만으로 칸이 찬다
  const shelf = Shelf.createShelf({});
  const first = Shelf.save(shelf, courseWith({ id: 'course' }), '한강', T0);
  const again = Shelf.save(shelf, courseWith({
    id: first.course.id, spots: [
      { id: 's1', lat: north(100), lon: LON, rad: WAYPOINT_RAD },
      { id: 's2', lat: north(200), lon: LON, rad: WAYPOINT_RAD }
    ]
  }), '한강', T0 + 5000);
  assert(again.ok === true, '갱신이 막혔습니다: ' + again.reason);
  assert(shelf.saved.length === 1, '칸이 늘었습니다 (' + shelf.saved.length + ')');
  assert(shelf.saved[0].spots.length === 2, '지점이 갱신되지 않았습니다');
});

test('넣은 뒤 코스를 고쳐도 보관함은 그대로다', function () {
  // 참조를 그대로 두면 달리는 중 지점을 지우는 것이 저장해 둔 것을 지우는 일이 된다
  const shelf = Shelf.createShelf({});
  const course = courseWith({ id: 'course' });
  Shelf.save(shelf, course, '가', T0);
  Course.remove(course, 's1');
  course.path.push({ lat: north(900), lon: LON });
  assert(shelf.saved[0].spots.length === 1, '지점이 함께 사라졌습니다');
  assert(shelf.saved[0].path.length === 2, '경로가 함께 늘었습니다');
});

test('시작점이 가까운 코스만 추천한다', function () {
  const shelf = Shelf.createShelf({});
  Shelf.save(shelf, courseWith({ id: 'course' }), '여기', T0);
  Shelf.save(shelf, courseWith({
    id: 'course',
    path: [{ lat: north(5000), lon: LON }, { lat: north(5500), lon: LON }]
  }), '먼 곳', T0);

  const near1 = Shelf.nearStart(shelf, north(20), LON);
  assert(near1.length === 1, '후보가 ' + near1.length + '개입니다');
  assert(near1[0].course.name === '여기', '먼 코스를 권했습니다');

  const none = Shelf.nearStart(shelf, north(2000), LON);
  assert(none.length === 0, '아무것도 가깝지 않은데 권했습니다');
});

test('추천은 가까운 순이다', function () {
  const shelf = Shelf.createShelf({});
  Shelf.keepLast(shelf, courseWith({ path: [{ lat: north(40), lon: LON }, { lat: north(500), lon: LON }] }), T0);
  Shelf.save(shelf, courseWith({ id: 'course', path: [{ lat: north(5), lon: LON }, { lat: north(500), lon: LON }] }), '가까운', T0);
  const list = Shelf.nearStart(shelf, LAT, LON);
  assert(list.length === 2, '후보가 ' + list.length + '개입니다');
  assert(list[0].course.name === '가까운', '가까운 순이 아닙니다');
});

test('위치를 모르면 추천하지 않는다', function () {
  const shelf = Shelf.createShelf({});
  Shelf.save(shelf, courseWith({ id: 'course' }), '가', T0);
  assert(Shelf.nearStart(shelf, null, null).length === 0, '위치 없이 권했습니다');
});

test('경로가 없는 코스는 추천 후보가 아니다', function () {
  // 시작점이 없으면 가까운지 물을 수 없다
  const shelf = Shelf.createShelf({});
  Shelf.save(shelf, courseWith({ id: 'course', path: [] }), '경로 없음', T0);
  assert(Shelf.nearStart(shelf, LAT, LON).length === 0, '시작점이 없는데 권했습니다');
});

/* ── 실행 ─────────────────────────────────────────────────────── */
let pass = 0, fail = 0;
const t0 = Date.now();
for (const c of cases) {
  try { c.fn(); pass++; console.log('  ok    ' + c.name); }
  catch (e) { fail++; console.log('  FAIL  ' + c.name + '\n        ' + e.message); }
}
console.log('\n' + pass + ' 통과 · ' + fail + ' 실패 · ' + ((Date.now() - t0) / 1000).toFixed(1) + '초');
process.exit(fail ? 1 : 0);
