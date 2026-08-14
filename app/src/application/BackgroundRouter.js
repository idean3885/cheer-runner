// 배경 위치를 누구에게 줄지 정하는 자리.
//
// 배경 구독은 앱에 하나뿐이고 그것을 쓰는 쪽은 둘이다. 진단과 달리기.
// 배경 맥락은 앱이 종료된 뒤 새로 만들어질 수 있어 기억이 없으므로, 누가 걸었는지는
// 파일에 적힌 것만 믿는다.
//
// 잘못 주면 남의 구독을 해제한다. 진단은 만료되면 스스로 구독을 끊는데, 달리기가 걸어둔
// 구독을 진단이 받으면 달리는 중에 측정이 멈춘다. 그래서 이 분배를 한 곳에 모은다.
//
// 기록이 없으면 아무도 주인이 아니다. 그때는 구독을 끊는다. 주인 없는 구독은
// 아무도 끄지 않는 채로 iOS 가 계속 앱을 깨운다.

export function createBackgroundRouter(deps) {
  const session = deps.session;
  const location = deps.location;
  const trace = deps.trace;
  const handlers = {};

  function register(owner, handler) {
    handlers[owner] = handler;
  }

  function route(payload) {
    const rec = session.read();
    if (!rec || !rec.owner || !handlers[rec.owner]) {
      if (trace) trace.append('mark', '=== 주인 없는 배경 구독을 해제합니다 ===');
      session.clear();
      return Promise.resolve(location.stopBackground());
    }
    return Promise.resolve(handlers[rec.owner](payload));
  }

  return { register: register, route: route, owners: function () { return Object.keys(handlers); } };
}
