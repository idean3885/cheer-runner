// 보관함. 코스가 들어가는 자리다.
//
// 코스와 따로 두는 이유는 규칙이 코스 하나에 없기 때문이다. 「몇 개까지 두는가」와
// 「어느 것을 덮어쓰는가」는 코스들 사이의 규칙이고, 코스 하나에 물어볼 수 없다.
//
// 칸이 두 종류다.
//
//   마지막   한 칸. 달리기를 마칠 때마다 덮어쓴다. 사용자가 아무것도 누르지 않아도 남는다
//   저장     SAVED_MAX 칸. 이름을 붙여 넣는다. 덮어쓰지 않는다
//
// 자동으로 덮어쓰는 칸과 사용자가 넣은 칸을 나눈 이유가 이 파일의 핵심이다.
// 한 종류로 두면 둘 중 하나가 반드시 틀린다. 전부 덮어쓰면 이름 붙여 둔 코스가
// 다음 달리기에 사라지고, 아무것도 덮어쓰지 않으면 마지막 달리기를 남기려고
// 매번 사용자가 저장을 눌러야 한다.
//
// 그래서 **저장 칸이 차면 거절한다.** 가장 오래된 것을 내보내지 않는다. 사용자가 이름을
// 붙여 넣은 것이라 조용히 사라지면 안 되고, 무엇을 버릴지는 사용자가 고를 일이다.

import { haversine } from './geo.js';
import { SAVED_MAX, START_TOL } from './constants.js';

export const SLOT = { last: 'last', saved: 'saved' };

export function createShelf(spec) {
  const s = spec || {};
  return {
    last: s.last || null,
    saved: (s.saved || []).slice(0, SAVED_MAX)
  };
}

// 넣을 때 복사한다. 참조를 그대로 두면 달리는 중에 지점을 지우면 보관함의 코스도
// 같이 바뀐다. 저장은 그 시점의 코스를 남기는 것이다
function snapshot(course, name, at) {
  return {
    id: course.id,
    name: name != null ? name : (course.name || ''),
    savedAt: at,
    path: (course.path || []).map(function (p) { return { lat: p.lat, lon: p.lon }; }),
    spots: (course.spots || []).map(function (p) {
      return { id: p.id, lat: p.lat, lon: p.lon, rad: p.rad };
    })
  };
}

function nextId(shelf) {
  let max = 0;
  shelf.saved.forEach(function (c) {
    const n = parseInt(String(c.id).replace(/[^0-9]/g, ''), 10);
    if (isFinite(n) && n > max) max = n;
  });
  return 'c' + (max + 1);
}

// 마지막 달리기. 지점이 없어도 넣는다. 경로만 있어도 다음에 지도에서 찍을 수 있다
export function keepLast(shelf, course, at) {
  shelf.last = snapshot(course, course.name || '', at);
  shelf.last.id = SLOT.last;
  return shelf.last;
}

// 이름을 붙여 넣는다. 이미 보관함에 있는 코스면 그 자리를 갱신한다.
// 그것을 새로 넣는 것으로 보면 불러와 지점 하나 더 찍는 것만으로 칸이 찬다
export function save(shelf, course, name, at) {
  const at2 = at || 0;
  const found = shelf.saved.findIndex(function (c) { return c.id === course.id; });
  if (found >= 0) {
    shelf.saved[found] = snapshot(course, name, at2);
    return { ok: true, slot: SLOT.saved, course: shelf.saved[found], replaced: true };
  }
  if (shelf.saved.length >= SAVED_MAX) {
    return { ok: false, reason: 'shelf-full', limit: SAVED_MAX };
  }
  const entry = snapshot(course, name, at2);
  entry.id = nextId(shelf);
  shelf.saved.push(entry);
  return { ok: true, slot: SLOT.saved, course: entry };
}

export function remove(shelf, id) {
  if (shelf.last && shelf.last.id === id) { shelf.last = null; return true; }
  const before = shelf.saved.length;
  shelf.saved = shelf.saved.filter(function (c) { return c.id !== id; });
  return shelf.saved.length < before;
}

export function find(shelf, id) {
  if (shelf.last && shelf.last.id === id) return shelf.last;
  return shelf.saved.find(function (c) { return c.id === id; }) || null;
}

// 보관함에 든 것 전부. 마지막이 앞이다. 방금 달린 것을 가장 자주 다시 부른다
export function entries(shelf) {
  const out = [];
  if (shelf.last) out.push({ slot: SLOT.last, course: shelf.last });
  shelf.saved.forEach(function (c) { out.push({ slot: SLOT.saved, course: c }); });
  return out;
}

export function isFull(shelf) {
  return shelf.saved.length >= SAVED_MAX;
}

// 지금 자리에서 시작할 만한 코스. 가까운 순으로 준다.
//
// 시작점만 본다. 코스 어디든 가까우면 추천하는 방식은 쓰지 않는다. 같은 코스를 반대로
// 달리거나 중간에서 끼어드는 경우에 지점 순서가 어긋나고, 그러면 응원이 엉뚱한 자리에서 온다.
//
// 고르는 것은 사용자다. 여기서 하는 일은 후보를 좁히는 것뿐이고, 저절로 불러오지 않는다.
// 저절로 불러오면 어제 달린 코스의 지점이 오늘 다른 길을 달리는 동안 울린다.
export function nearStart(shelf, lat, lon) {
  if (lat == null || lon == null) return [];
  return entries(shelf)
    .map(function (e) {
      const start = e.course.path && e.course.path.length ? e.course.path[0] : null;
      return start
        ? { slot: e.slot, course: e.course, distance: haversine(lat, lon, start.lat, start.lon) }
        : null;
    })
    .filter(function (e) { return e && e.distance <= START_TOL; })
    .sort(function (a, b) { return a.distance - b.distance; });
}

// 코스 하나의 길이. 목록에서 어느 코스인지 가르는 데 쓴다.
// 지점 수만 보여주면 3곳짜리 코스 둘을 구분할 수 없다
export function pathLength(course) {
  const path = (course && course.path) || [];
  let sum = 0;
  for (let i = 1; i < path.length; i++) {
    sum += haversine(path[i - 1].lat, path[i - 1].lon, path[i].lat, path[i].lon);
  }
  return sum;
}
