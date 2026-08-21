// 표기 정본. 달리기 화면과 코스 화면이 같은 값을 같은 모양으로 적는다.
//
// 한 자리에 모으는 이유는 색과 같다. 페이스 표기가 두 파일에 각각 적히면 한쪽만 바뀐다.

export function fmtDur(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const two = function (n) { return (n < 10 ? '0' : '') + n; };
  return (h > 0 ? h + ':' : '') + two(m) + ':' + two(sec);
}

export function fmtPace(sec) {
  if (sec == null || !isFinite(sec)) return '--\'--"';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return m + "'" + (s < 10 ? '0' : '') + s + '"';
}

// 날짜만으로는 오늘 두 번 달린 것을 구분할 수 없다. 시각까지 적는다
export function fmtWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const two = function (n) { return (n < 10 ? '0' : '') + n; };
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
}

// 구간 기록 한 줄. 도달·표시·종료가 같은 형태로 남는다
export function splitText(sp) {
  const head = sp.by === 'finish' ? '종료'
    : (sp.idx + 1) + '번 지점 ' + (sp.by === 'mark' ? '표시' : '도착');
  return head + ' · 구간 ' + Math.round(sp.segDist) + 'm · ' + fmtPace(sp.pace);
}
