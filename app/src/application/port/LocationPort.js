// 위치 포트. application 이 필요를 선언하고 infrastructure 가 채운다.
//
// 이 파일에 구현은 없다. 계약만 적는다. 부르는 쪽은 위치가 어디서 오는지 모르고,
// 어댑터를 교체하면 그 위 전부가 따라온다.
//
// 구현체는 둘이다.
//   ExpoLocationAdapter    운영. 배경 작업으로 위치를 받는다
//   ReplayLocationAdapter  시험 대역. 고정 표본을 흘려 넣는다 (ADR 0004)
//
// 넘기는 값은 플랫폼이 주는 모양 그대로다. 좌표만 뽑아 넘기면 어댑터의 필드 옮기기가
// 시험되지 않아서, 단위를 잘못 읽은 결함이 모든 시험을 통과하고 실측에서만 드러난다.

/**
 * @typedef {Object} PlatformFix
 * 플랫폼이 주는 위치 객체. expo-location 의 LocationObject 모양을 유지한다.
 * @property {{latitude:number, longitude:number, accuracy:number|null,
 *             speed:number|null, altitude:number|null, heading:number|null}} coords
 * @property {number} timestamp
 */

/**
 * @typedef {Object} LocationPort
 * @property {() => Promise<{foreground:string, background:string}>} requestPermissions
 *   전경을 먼저 받고 승인되면 배경을 받는다. iOS 는 이 순서만 허용한다
 * @property {() => Promise<{foreground:string, background:string}>} getPermissions
 * @property {(onFix:(fixes:PlatformFix[])=>void) => Promise<void>} startBackground
 *   화면이 꺼진 뒤에도 위치를 받는다. 묶음으로 들어온다
 * @property {() => Promise<void>} stopBackground
 * @property {() => Promise<boolean>} isBackgroundRunning
 * @property {(onFix:(fix:PlatformFix)=>void) => Promise<{remove:()=>void}>} watchForeground
 *   화면이 켜져 있을 때만. 배경이 0건일 때 위치 자체의 문제인지 가르는 데 쓴다
 * @property {() => Promise<boolean>} servicesEnabled
 *   기기의 위치 서비스가 켜져 있는가. 권한과 다른 사실이고 사용자가 할 일도 다르다
 * @property {() => Promise<PlatformFix|null>} once
 *   위치 한 건. 정해진 시간 안에 못 받으면 없음을 돌려준다.
 *   기다리다 돌아오지 않으면 화면이 「받는 중」에 머물고, 못 받는다는 사실을 말할 수 없다
 */

export const PERMISSION = {
  granted: 'granted',
  denied: 'denied',
  undetermined: 'undetermined'
};
