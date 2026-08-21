// 달리기. 집합체의 뿌리다.
//
// 도메인 한 문장은 이렇다. 러너가 한 번의 달리기에서 시작부터 종료까지의 거리를 측정하고,
// 그 사이에 응원받고 싶은 위치를 지정해 두었다면 그곳에서 응원받는 것.
//
// 그래서 이 파일에 세 동사가 있다. 측정한다 · 지정한다 · 응원받는다.
// 지정은 코스가 갖고, 여기서는 지정된 지점에 닿았는지만 본다.
//
// 상태를 불린으로 두지 않는다. 불린은 전이를 표현하지 못해서
// 종료된 달리기에 위치가 들어오는 것을 막을 자리가 없다.

import { haversine, paceOf } from './geo.js';
import { createTrack, extend, windowPace, averagePace, displaySegments } from './Track.js';
import { IDLE_MS, MOVE_MIN, REC_PATH_MAX } from './constants.js';

export const STATE = { ready: 'ready', running: 'running', finished: 'finished' };

// 위치의 시각은 데이터에서 온다. 벽시계를 읽으면 두 가지가 깨진다.
// 같은 순간에 여러 위치를 넣는 재생이 전부 버려지고, 실제 달리기에서도 콜백이
// 늦게 도착한 만큼 시간이 잘못 붙어 페이스가 밀린다
export function timeOf(fix) {
  const t = fix && fix.timestamp;
  return (typeof t === 'number' && isFinite(t) && t > 0) ? t : null;
}

export function createRun(spec) {
  const s = spec || {};
  return {
    state: STATE.ready,
    startedAt: null,
    finishedAt: null,
    spots: s.spots || [],      // 지정된 지점. 순서대로 하나씩 목표가 된다
    nextIdx: 0,
    track: null,
    arrivals: [],              // 도달 기록. 응원과 순번 판정의 근거 { idx, at, segMs, segDist, pace }
    splits: [],                // 구간 기록. 지점을 지나는 순간마다 닫힌다 { by, idx, at, segMs, segDist, pace }
    fixCount: 0,
    gapMax: 0,
    lastFixAt: null,
    accSum: 0,
    accMax: 0,
    segAt: null,               // 현재 구간의 시작. 지점에 닿을 때마다 갱신된다
    segDist0: 0,
    // 마지막으로 실제 움직인 시점. 위치가 오는 것과 움직이는 것은 다르다.
    // 거리 필터를 0 으로 두었으므로 제자리에서도 위치는 계속 들어온다
    movedAt: null,
    movedDist: 0
  };
}

export function start(run, at) {
  if (run.state !== STATE.ready) return { started: false, reason: 'already-' + run.state };
  run.state = STATE.running;
  run.startedAt = at;
  run.segAt = at;
  return { started: true };
}

// 위치를 몇 건 받았고 얼마나 뜸했고 얼마나 정확했나. 거리와 무관한 집계다.
// 따로 둔 이유는 accept 가 세는 일까지 하면 한 함수가 판정과 집계를 겸하기 때문이다
function countFix(run, at, c) {
  const gapMs = run.lastFixAt ? at - run.lastFixAt : 0;
  if (gapMs > run.gapMax) run.gapMax = gapMs;
  run.lastFixAt = at;
  run.fixCount++;
  if (c.accuracy == null) return;
  run.accSum += c.accuracy;
  if (c.accuracy > run.accMax) run.accMax = c.accuracy;
}

// 종료된 달리기는 위치를 받지 않는다. 이 불변식이 이 함수의 첫 줄이다
export function accept(run, fix) {
  if (run.state !== STATE.running) {
    return { accepted: false, reason: 'not-running' };
  }
  const at = timeOf(fix);
  if (at == null) return { accepted: false, reason: 'no-timestamp' };
  const c = fix.coords;
  if (!c || typeof c.latitude !== 'number' || typeof c.longitude !== 'number') {
    return { accepted: false, reason: 'no-coords' };
  }

  countFix(run, at, c);

  if (!run.track) {
    run.track = createTrack(at, c.latitude, c.longitude);
    run.movedAt = at;
    return { accepted: true, added: 0, arrival: null, gap: false };
  }

  const grew = extend(run.track, at, c);

  // 잡음이 조금씩 쌓인 것과 실제로 움직인 것을 가른다
  if (run.track.dist - run.movedDist >= MOVE_MIN) {
    run.movedDist = run.track.dist;
    run.movedAt = at;
  }

  const arrival = checkArrival(run, at, c);

  return {
    accepted: true,
    added: grew.added,
    gap: grew.gap,
    tickClosed: grew.tickClosed,
    arrival: arrival
  };
}

// 지금 목표인 지점. 다 지났으면 없다
export function currentTarget(run) {
  return run.nextIdx < run.spots.length ? run.spots[run.nextIdx] : null;
}

// 목표까지 남은 거리
export function distanceToTarget(run, lat, lon) {
  const t = currentTarget(run);
  return t ? haversine(lat, lon, t.lat, t.lon) : null;
}

// 구간을 닫는다. 지점을 지나는 순간이 여기 모인다 (도달·달리며 생성·종료).
// 어느 경로로 닫혀도 평균페이스는 건드리지 않는다. 지점은 구간만 닫는다
function closeSplit(run, at, by, idx) {
  const segMs = at - run.segAt;
  const segDist = run.track.dist - run.segDist0;
  const record = {
    by: by, idx: idx, at: at,
    segMs: segMs, segDist: segDist,
    pace: paceOf(segDist, segMs)
  };
  run.splits.push(record);
  run.segAt = at;
  run.segDist0 = run.track.dist;
  return record;
}

function checkArrival(run, at, c) {
  const t = currentTarget(run);
  if (!t) return null;
  const d = haversine(c.latitude, c.longitude, t.lat, t.lon);
  if (d > t.rad) return null;

  const split = closeSplit(run, at, 'arrive', run.nextIdx);
  const record = {
    idx: run.nextIdx,
    at: at,
    segMs: split.segMs,
    segDist: split.segDist,
    pace: split.pace != null ? split.pace : averagePace(run.track, at),
    isLast: run.nextIdx === run.spots.length - 1
  };
  run.arrivals.push(record);
  run.nextIdx++;
  return record;
}

// 달리는 중에 지점을 더한다. 뒤에 붙이므로 아직 지나지 않은 목표가 된다.
// 이미 지난 지점 사이에 끼워 넣으면 번호와 도달 기록이 어긋난다
export function addSpot(run, spot) {
  if (run.state !== STATE.running) return false;
  run.spots.push(spot);
  return true;
}

// 달리며 지점을 만든 자리는 곧 지나는 자리다. 그래서 구간을 닫는다.
// 시각은 마지막 위치의 것을 쓴다. 터치의 벽시계는 위치 시계와 다를 수 있다
export function passSpot(run, idx) {
  if (run.state !== STATE.running || !run.track) return null;
  return closeSplit(run, run.track.lastAt, 'mark', idx);
}

// 진행 중 구간. 마지막으로 닫힌 자리부터 지금까지다
export function currentSegment(run, at) {
  if (run.state !== STATE.running || !run.track || run.segAt == null) return null;
  const ms = at - run.segAt;
  const dist = run.track.dist - run.segDist0;
  return { ms: ms, dist: dist, pace: paceOf(dist, ms) };
}

export function finish(run, at) {
  if (run.state !== STATE.running) return { finished: false, reason: 'not-running' };
  // 이미 닫힌 구간이 있으면 마지막 지점부터 종료까지도 구간이다.
  // 하나도 없으면 닫지 않는다. 전체 요약과 같은 것을 두 번 적게 된다
  if (run.track && run.splits.length > 0) closeSplit(run, at, 'finish', null);
  run.state = STATE.finished;
  run.finishedAt = at;
  return { finished: true, summary: summary(run) };
}

// 3분간 움직이지 않으면 스스로 끝낸다. 러너가 종료를 누르지 않고 집에 가는 일이
// 실제로 있고, 그때 배경 구독이 계속 살아 배터리를 먹는다
export function isIdle(run, at) {
  if (run.state !== STATE.running || run.movedAt == null) return false;
  return at - run.movedAt >= IDLE_MS;
}

export function summary(run) {
  const t = run.track;
  const endAt = run.finishedAt || (t ? t.lastAt : run.startedAt);
  return {
    startedAt: run.startedAt,
    finishedAt: endAt,
    ms: run.startedAt != null ? endAt - run.startedAt : 0,
    dist: t ? t.dist : 0,
    distBySpeed: t ? t.distBySpeed : 0,
    distByGeo: t ? t.distByGeo : 0,
    speedFixes: t ? t.speedFixes : 0,
    geoFixes: t ? t.geoFixes : 0,
    pace: t ? averagePace(t, endAt) : null,
    windowPace: t ? windowPace(t) : null,
    arrivals: run.arrivals.slice(),
    splits: run.splits.slice(),
    // 표시용 경로. 기록은 자기 경로를 갖는다. 결손 조각을 유지하고 상한으로 솎는다
    path: t ? displaySegments(t, REC_PATH_MAX) : [],
    spots: run.spots.length,
    fixCount: run.fixCount,
    gapMax: run.gapMax,
    accAvg: run.fixCount ? run.accSum / run.fixCount : null,
    accMax: run.accMax
  };
}
