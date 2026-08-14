// 연결 포트의 운영 구현체.
//
// 알 수 없는 값을 끊긴 것으로 읽지 않는다. iOS 가 「닿는가」를 아직 판단하지 못한 동안
// undefined 를 주는데, 그것을 거짓으로 보면 앱을 켠 직후 몇 초 동안 달리기가 막힌다.
// 실제로 막을 것은 안 닿는 것이 확인된 상태 하나다.

import * as Network from 'expo-network';

function onlineFrom(state) {
  if (!state) return true;
  if (state.isConnected === false) return false;
  // 신호는 잡혔는데 밖으로 못 나가는 상태. 지도 타일이 오지 않는다
  if (state.isInternetReachable === false) return false;
  return true;
}

export const ExpoNetworkAdapter = {
  async isOnline() {
    try {
      return onlineFrom(await Network.getNetworkStateAsync());
    } catch (e) {
      // 물어볼 수 없는 것을 끊김으로 보지 않는다
      return true;
    }
  },

  subscribe(fn) {
    try {
      return Network.addNetworkStateListener(function (state) { fn(onlineFrom(state)); });
    } catch (e) {
      return { remove: function () {} };
    }
  }
};
