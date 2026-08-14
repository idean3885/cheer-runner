// 코스. 달리기와 따로 사는 뿌리다.
//
// 따로 두는 이유는 수명이 다르기 때문이다. 달리기는 한 번 달리면 끝나고 코스는 남는다.
// 한 뿌리에 넣으면 코스를 고치려고 달리기를 열어야 한다.
//
// 갖는 행위는 넷이고 불변식은 하나다. 지점은 코스를 벗어나지 않는다.
//
//   markHere  달리는 중에 지금 여기를 표시한다
//   promote   끝난 달리기의 경로 점을 지점으로 올린다
//   pin       지도에서 임의의 자리를 찍는다
//   remove    지점을 지운다
//
// 거부하는 길은 pin 하나다. markHere 와 promote 는 러너가 실제로 지난 자리이므로
// 정의상 경로 위에 있다. 셋 다 같은 검사를 지나게 만들면 있을 수 없는 실패를
// 화면이 처리해야 하고, 그 분기는 영원히 시험되지 않는다.

import { distanceToPath } from './geo.js';
import { COURSE_TOL, WAYPOINT_RAD, TRACK_STEP } from './constants.js';

export function createCourse(spec) {
  const s = spec || {};
  return {
    id: s.id || 'course',
    name: s.name || '',
    path: s.path || [],        // [{lat, lon}]. 이 코스의 기준 경로
    spots: s.spots || []       // [{id, lat, lon, rad}]
  };
}

function nextId(course) {
  let max = 0;
  course.spots.forEach(function (p) {
    const n = parseInt(String(p.id).replace(/[^0-9]/g, ''), 10);
    if (isFinite(n) && n > max) max = n;
  });
  return 's' + (max + 1);
}

function place(course, lat, lon) {
  const spot = { id: nextId(course), lat: lat, lon: lon, rad: WAYPOINT_RAD };
  course.spots.push(spot);
  return spot;
}

// 지금 여기. 러너가 달리는 중에 힘들다고 표시한 자리다.
// 이번 달리기에서는 울리지 않는다. 방금 지난 자리라 바로 도달 판정에 걸린다
export function markHere(course, lat, lon) {
  return place(course, lat, lon);
}

// 끝난 달리기의 경로 점을 올린다
export function promote(course, point) {
  return place(course, point.lat, point.lon);
}

// 지도에서 찍은 자리. 코스를 벗어나면 거부한다.
// 거부하지 않으면 지정은 되는데 영원히 도달하지 않는 지점이 남는다
export function pin(course, lat, lon) {
  // 기준 경로가 없으면 거절한다. 벗어날 기준이 없으면 불변식을 지킬 수 없고,
  // 지킬 수 없는 상태에서 받아두면 영원히 도달하지 않는 지점이 생긴다.
  // 한 번 달리면 그 경로가 코스가 되고 그때부터 지정할 수 있다
  if (!course.path || !course.path.length) {
    return { ok: false, reason: 'no-course' };
  }
  const d = distanceToPath(lat, lon, course.path);
  if (d > COURSE_TOL) {
    return { ok: false, reason: 'off-course', distance: d, limit: COURSE_TOL };
  }
  return { ok: true, spot: place(course, lat, lon), distance: d };
}

export function remove(course, id) {
  const before = course.spots.length;
  course.spots = course.spots.filter(function (p) { return p.id !== id; });
  return course.spots.length < before;
}

// 사후 승격 후보. 경로를 일정 간격으로 솎아 보여준다.
// 점 2,500개를 그대로 늘어놓으면 고를 수 없다
export function promotionCandidates(track) {
  const out = [];
  let mark = 0;
  track.points.forEach(function (p) {
    if (p.dist >= mark) { out.push(p); mark = p.dist + TRACK_STEP; }
  });
  return out;
}
