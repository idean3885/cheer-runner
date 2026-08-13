// 좌표와 페이스 계산. 상태가 없다.
//
// 집합체에서 떼어 두는 이유는 이 계산이 주행에도 코스에도 쓰이기 때문이다.
// 어느 한쪽에 두면 다른 쪽이 그것을 부르려고 서로를 알아야 한다.

const R = 6371000;   // m. 지구 반지름

function rad(deg) { return deg * Math.PI / 180; }

// 두 점 사이의 거리. 러닝 거리에서 고도차는 무시한다
export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// km 당 초. 거리가 0 이면 페이스가 없다. 0 이나 무한이 아니라 없음이다
export function paceOf(distM, ms) {
  if (!(distM > 0) || !(ms > 0)) return null;
  return (ms / 1000) / (distM / 1000);
}

// 점이 선분에서 떨어진 거리. 코스 이탈 판정에 쓴다.
// 경로는 점의 열이므로 점과 점 사이 어디든 러너가 지나간 자리로 본다
export function distanceToSegment(lat, lon, aLat, aLon, bLat, bLon) {
  // 짧은 거리에서는 평면으로 봐도 오차가 판정 한계보다 작다.
  // 경도는 위도에 따라 좁아지므로 그만큼 줄여 쓴다
  const k = Math.cos(rad((aLat + bLat) / 2));
  const px = (lon - aLon) * k, py = lat - aLat;
  const bx = (bLon - aLon) * k, by = bLat - aLat;
  const len2 = bx * bx + by * by;
  let t = len2 === 0 ? 0 : (px * bx + py * by) / len2;
  t = Math.max(0, Math.min(1, t));
  const cLat = aLat + by * t, cLon = aLon + (bLon - aLon) * t;
  return haversine(lat, lon, cLat, cLon);
}

// 점이 경로에서 떨어진 최소 거리. 경로가 한 점뿐이면 그 점까지의 거리다
export function distanceToPath(lat, lon, path) {
  if (!path || !path.length) return Infinity;
  if (path.length === 1) return haversine(lat, lon, path[0].lat, path[0].lon);
  let min = Infinity;
  for (let i = 1; i < path.length; i++) {
    const d = distanceToSegment(lat, lon, path[i - 1].lat, path[i - 1].lon, path[i].lat, path[i].lon);
    if (d < min) min = d;
  }
  return min;
}
