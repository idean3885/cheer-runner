// 위치 포트의 운영 구현체.
//
// 배경 작업은 화면과 다른 실행 맥락에서 깨어난다. 그래서 두 제약이 있다.
//   가. 작업 등록이 모듈 최상위여야 한다. 컴포넌트 안에서는 그 맥락이 찾지 못한다
//   나. 그 맥락은 화면의 상태를 볼 수 없다. 전달은 저장을 거친다
//
// 이 두 제약이 어댑터 안에만 있어야 한다. 위로 새면 화면이 배경 작업의 존재를 알게 된다.

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

const TASK = 'cheer-runner-background-location';

// 배경 맥락이 부를 처리기. 등록은 모듈 최상위여야 하므로 참조를 두고 나중에 채운다.
// 맥락이 새로 만들어지면 이 값은 비어 있고, 그래서 처리기가 저장에 직접 적는다
let sink = null;

export function setSink(fn) { sink = fn; }

TaskManager.defineTask(TASK, function (body) {
  if (!sink) return;
  if (body.error) { sink({ error: body.error.message, fixes: [] }); return; }
  sink({ error: null, fixes: (body.data && body.data.locations) || [] });
});

// 수신 조건. distanceInterval 0 이 핵심이다.
//
// 거리 필터를 그대로 두면 정확도에 딸린 기본값이 적용돼 제자리에서는 갱신이 오지 않는다.
// 그러면 움직이지 않은 것과 배경이 중단된 것을 구분할 수 없어 판정이 불가능해진다.
// 0 으로 두면 iOS 가 자기 주기로 보내므로 제자리에서도 들어온다.
//
// timeInterval 은 Android 전용이다. iOS 에서 이것으로 같은 문제를 풀려 했던 것이 오판이었다
const BASE = {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 3000,      // Android 에서만 적용된다
  distanceInterval: 0
};

export const ExpoLocationAdapter = {
  async requestPermissions() {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') return { foreground: fg.status, background: 'undetermined' };
    // iOS 는 전경 승인 뒤에만 배경을 물어볼 수 있다
    const bg = await Location.requestBackgroundPermissionsAsync();
    return { foreground: fg.status, background: bg.status };
  },

  async getPermissions() {
    const fg = await Location.getForegroundPermissionsAsync();
    const bg = await Location.getBackgroundPermissionsAsync();
    return { foreground: fg.status, background: bg.status };
  },

  async startBackground() {
    await Location.startLocationUpdatesAsync(TASK, Object.assign({}, BASE, {
      // iOS 가 배터리를 위해 스스로 멈추면 원인을 우리 코드에서 찾게 된다
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.Fitness,
      showsBackgroundLocationIndicator: true,
      // 묶어서 미루면 배경 생존 판정이 흐려진다
      deferredUpdatesInterval: 0,
      deferredUpdatesDistance: 0,
      foregroundService: {
        notificationTitle: '치어러너',
        notificationBody: '달리기를 기록하는 중입니다',
        notificationColor: '#1270b0'
      }
    }));
  },

  async stopBackground() {
    if (await TaskManager.isTaskRegisteredAsync(TASK)) {
      await Location.stopLocationUpdatesAsync(TASK);
    }
  },

  isBackgroundRunning() {
    return TaskManager.isTaskRegisteredAsync(TASK);
  },

  watchForeground(onFix) {
    return Location.watchPositionAsync(BASE, onFix);
  },

  // 한 번만 받는다. 달리기를 시작하기 전에 지도를 러너 자리에 맞추는 데 쓴다
  once() {
    return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  }
};
