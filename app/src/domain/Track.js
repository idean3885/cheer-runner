// 궤적. 달리기 안에서만 산다.
//
// 갖는 행위는 둘이다. 늘리기와 결손 표시.
// 불변식은 하나다. 거리는 감소하지 않는다.
//
// 거리 증분을 고르는 순서가 이 파일의 핵심이다. 순서를 바꾸면 값이 조용히 틀린다.
//   1. 정확도 컷을 가장 먼저 본다. 오차 200m 인 위치는 도플러 속도도 믿을 수 없다
//   2. 도플러 속도가 있으면 그것으로 적분한다. 좌표 차분보다 정확하다
//   3. 없으면 좌표 차분으로 떨어진다
//   4. 사람이 낼 수 없는 속도가 나오면 버린다
//
// 선행 검증에서 좌표 차분만 쓰다가 거리가 약 15% 짧게 나왔다. 작은 이동이
// 정확도 잡음에 묻혀 버려진 것이 원인이었다.

import { haversine, paceOf } from './geo.js';
import { ACC_CUT, SPEED_MAX, GAP_S, TRACK_MAX, TICK_MS, TICK_WIN, POINT_MIN } from './constants.js';

export function createTrack(startedAt, lat, lon) {
  return {
    startedAt: startedAt,
    lastAt: startedAt,
    dist: 0,
    distBySpeed: 0,      // 견주기용. 도플러 속도만으로 쌓은 거리
    distByGeo: 0,        // 견주기용. 좌표 차분만으로 쌓은 거리
    speedFixes: 0,
    geoFixes: 0,
    prev: { lat: lat, lon: lon },
    points: [{ lat: lat, lon: lon, dist: 0, sec: 0 }],
    gaps: [],            // 결손이 생긴 점의 자리
    ticks: [],           // { dist, ms, stale }
    tickAt: startedAt,
    tickDist0: 0
  };
}

function usableSpeed(coords) {
  const s = coords.speed;
  return (typeof s === 'number' && isFinite(s) && s >= 0) ? s : null;
}

// 늘리기. 위치 하나를 받아 거리와 점과 틱을 갱신한다.
// 되돌려 주는 것은 이 위치로 무엇이 일어났는가다. 화면이 그것을 읽는다
export function extend(track, at, coords) {
  const dt = (at - track.lastAt) / 1000;
  if (!(dt > 0)) return { added: 0, gap: false, tickClosed: null };
  track.lastAt = at;

  const lat = coords.latitude, lon = coords.longitude, acc = coords.accuracy;
  const dGeo = haversine(track.prev.lat, track.prev.lon, lat, lon);
  track.prev = { lat: lat, lon: lon };
  const sp = usableSpeed(coords);
  const tooCoarse = acc != null && acc > ACC_CUT;

  if (sp != null && dt <= GAP_S) track.distBySpeed += sp * dt;
  if (!tooCoarse) track.distByGeo += dGeo;

  let added;
  if (tooCoarse) added = 0;
  else if (sp != null && dt <= GAP_S) { added = sp * dt; track.speedFixes++; }
  else { added = dGeo; track.geoFixes++; }
  if (added / dt > SPEED_MAX) added = 0;
  track.dist += added;

  const gap = dt >= GAP_S;
  if (gap) markGap(track);

  // 표시용 점은 솎아도 된다. 거리 계산과 무관하다.
  // 단 결손 구간은 실제 경로를 모르므로 반드시 점을 남겨 선을 끊는다
  const last = track.points[track.points.length - 1];
  if (gap || haversine(last.lat, last.lon, lat, lon) >= POINT_MIN) {
    track.points.push({
      lat: lat, lon: lon,
      dist: Math.round(track.dist),
      sec: Math.round((at - track.startedAt) / 1000)
    });
    if (track.points.length > TRACK_MAX) track.points = track.points.slice(-TRACK_MAX);
  }

  const tickClosed = closeTickIfDue(track, at);
  return { added: added, gap: gap, tickClosed: tickClosed };
}

// 결손 표시. 이 자리에서 경로 선이 끊긴다
export function markGap(track) {
  track.gaps.push(track.points.length);
}

// 틱은 위치 수신 시점에 닫는다. 타이머는 화면이 꺼지면 조절되므로 믿지 않는다
function closeTickIfDue(track, at) {
  const ms = at - track.tickAt;
  if (ms < TICK_MS) return null;

  // 수신이 길게 끊기면 한 틱이 그 공백을 전부 담는다. 선행 검증에서 652초를
  // 담은 틱이 창 평균에 들어가 페이스 비교를 망가뜨렸다. 그런 틱은 창에서 뺀다
  const stale = ms > TICK_MS * TICK_WIN;
  const tick = { dist: track.dist - track.tickDist0, ms: ms, stale: stale };
  track.ticks.push(tick);
  track.tickAt = at;
  track.tickDist0 = track.dist;
  return tick;
}

// 창 페이스. 결손 틱이 섞이면 그 창은 값을 내지 않는다
export function windowPace(track) {
  const tail = track.ticks.slice(-TICK_WIN);
  if (tail.length < TICK_WIN) return null;
  if (tail.some(function (t) { return t.stale; })) return null;
  let dist = 0, ms = 0;
  tail.forEach(function (t) { dist += t.dist; ms += t.ms; });
  return paceOf(dist, ms);
}

export function averagePace(track, at) {
  return paceOf(track.dist, at - track.startedAt);
}

// 결손을 뺀 구간들. 화면이 선을 나눠 그리는 데 쓴다
export function segments(track) {
  const cuts = track.gaps.slice();
  const out = [];
  let from = 0;
  cuts.forEach(function (c) {
    if (c > from) out.push(track.points.slice(from, c));
    from = c;
  });
  out.push(track.points.slice(from));
  return out.filter(function (s) { return s.length > 1; });
}
