// 음성 포트. application 이 필요를 선언하고 infrastructure 가 채운다.
//
// 계약의 핵심은 결과를 되돌려 준다는 점 하나다. 부르고 끝나는 함수로 두면
// 부른 사실만 남고 재생됐는지는 알 수 없다. 진단에서 판정해야 하는 것이 바로 그것이다.

/**
 * @typedef {'started'|'done'|'stopped'|'error'} SpeechOutcome
 *   started  합성기가 읽기 시작했다
 *   done     문장을 끝까지 읽었다
 *   stopped  중간에 끊겼다. 오디오 세션 중단이거나 stop 호출이다
 *   error    합성 자체가 실패했다
 */

/**
 * @typedef {Object} SpeechPort
 * @property {(text:string, onOutcome:(o:SpeechOutcome, detail?:string)=>void) => void} speak
 *   결과 콜백은 한 문장당 한 번만 온다. done 과 stopped 는 함께 오지 않는다
 * @property {() => void} stop
 */
