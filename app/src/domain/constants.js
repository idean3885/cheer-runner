// 도메인 상수. 근거는 docs/DOMAIN.md 의 상수 표에 있다.
//
// 조절 항목으로 열지 않는다. 값을 사용자가 고를 수 있게 두면 어떤 값에서 측정된
// 기록인지 알 수 없어 달리기끼리 견줄 수 없다.

export const ACC_CUT = 60;          // m. 이보다 부정확한 위치는 거리에 넣지 않는다
export const SPEED_MAX = 10;        // m/s. 사람이 낼 수 없는 값은 버린다
export const GAP_S = 15;            // 초. 이보다 뜸하면 결손 구간
export const WAYPOINT_RAD = 30;     // m. 지점 반경
export const COURSE_TOL = 30;       // m. 지점이 경로에서 떨어질 수 있는 한계
export const START_TOL = 50;        // m. 저장된 코스의 시작점과 같은 자리로 볼 오차
export const SAVED_MAX = 2;         // 이름 붙여 저장하는 칸. 마지막 달리기 한 칸은 따로다
export const TRACK_MAX = 2500;      // 경로 점 상한
export const TRACK_STEP = 100;      // m. 사후 지점 승격 목록의 간격
export const IDLE_MS = 180000;      // 무이동 판정 시간
export const MOVE_MIN = 10;         // m. 이만큼 늘면 움직인 것으로 본다. 잡음이 쌓인 것과 가른다
export const TICK_MS = 10000;       // 페이스 표본 단위
export const TICK_WIN = 3;          // 페이스 창. 10초 표본 하나는 값이 튄다
export const PACE_MIN_DIST = 100;   // m. 이만큼 달리기 전에는 페이스를 내지 않는다. 표본이 모자란다
export const PACE_SHOW_MAX = 1800;  // 초/km. 이보다 느린 페이스는 정지 잡음이라 화면에 내지 않는다
export const POINT_MIN = 5;         // m. 이보다 가까운 점은 표시용으로 솎는다
export const REC_PATH_MAX = 400;    // 기록에 남기는 표시용 경로 점 상한
export const RUNS_MAX = 50;         // 기록 보관 상한. 넘치면 오래된 것부터 밀려난다

// 도달 반경과 이탈 한계가 같아야 도달이 보장된다. 지점이 경로에서 d 떨어져 있고
// 도달 반경이 r 이면 러너는 지점으로부터 최소 d 까지만 접근하므로 d <= r 일 때만 닿는다.
// 이 등식이 깨지면 지정은 되지만 영원히 도달하지 않는 지점이 생긴다
if (COURSE_TOL !== WAYPOINT_RAD) {
  throw new Error('COURSE_TOL 과 WAYPOINT_RAD 가 다르면 도달하지 않는 지점이 생깁니다');
}
