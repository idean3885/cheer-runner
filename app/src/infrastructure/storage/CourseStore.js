// 코스와 달리기 기록 저장.
//
// 기기에만 둔다. 서버가 없어서가 아니라 이 도메인에 서버가 필요하지 않기 때문이다.
// 코스는 러너 한 사람의 것이고 남과 견주는 일은 다른 컨텍스트다.
//
// 쓰기 실패를 삼키지 않고 알린다. 기록과 달리 코스는 사용자가 만든 것이라
// 조용히 사라지면 안 된다.

import { File, Paths } from 'expo-file-system';
import { RUNS_MAX } from '../../domain/constants.js';

const COURSE = 'course.json';
const SHELF = 'courses.json';
const RUNS = 'runs.jsonl';

function handle(name) { return new File(Paths.document, name); }

function readJSON(name, fallback) {
  try {
    const f = handle(name);
    if (!f.exists) return fallback;
    const text = f.textSync();
    return text.length > 1 ? JSON.parse(text) : fallback;
  } catch (e) { return fallback; }
}

export const CourseStore = {
  readCourse() { return readJSON(COURSE, {}); },

  writeCourse(course) {
    try {
      const f = handle(COURSE);
      if (!f.exists) f.create();
      f.write(JSON.stringify(course));
      return true;
    } catch (e) { return false; }
  },

  // 보관함. 지금 달리는 코스(course.json)와 따로 둔다.
  //
  // 한 파일에 넣으면 달리는 중 지점을 찍을 때마다 보관함 전체를 다시 쓴다. 그 쓰기가
  // 실패하면 저장해 둔 코스까지 잃는다. 수명이 다른 것을 같은 파일에 두지 않는다
  readShelf() { return readJSON(SHELF, {}); },

  writeShelf(shelf) {
    try {
      const f = handle(SHELF);
      if (!f.exists) f.create();
      f.write(JSON.stringify(shelf));
      return true;
    } catch (e) { return false; }
  },

  appendRun(summary) {
    try {
      const f = handle(RUNS);
      if (!f.exists) f.create();
      f.write(JSON.stringify(summary) + '\n', { append: true });
      // 보관 상한을 넘으면 오래된 것부터 밀어낸다. 기록에 경로가 실리면서
      // 무한히 쌓게 두면 파일이 계속 자란다. 종료마다 한 번이라 비용이 문제되지 않는다
      const lines = f.textSync().split('\n').filter(function (s) { return s.length > 2; });
      if (lines.length > RUNS_MAX) {
        f.write(lines.slice(-RUNS_MAX).join('\n') + '\n');
      }
      return true;
    } catch (e) { return false; }
  },

  // 기록의 코스 연결을 이관한다. 코스를 저장하며 식별자·이름이 바뀔 때 부른다.
  // 파일을 통째로 다시 쓴다. 기록이 상한(RUNS_MAX)으로 잘려 있어 크기가 작다
  relinkRuns(fromId, toId, name) {
    try {
      const runs = this.readRuns().map(function (r) {
        if (r.courseId !== fromId && r.courseId !== toId) return r;
        return Object.assign({}, r, { courseId: toId, courseName: name || '' });
      });
      const f = handle(RUNS);
      if (!f.exists) f.create();
      f.write(runs.map(function (r) { return JSON.stringify(r); }).join('\n') + (runs.length ? '\n' : ''));
      return true;
    } catch (e) { return false; }
  },

  readRuns() {
    try {
      const f = handle(RUNS);
      if (!f.exists) return [];
      return f.textSync().split('\n')
        .filter(function (s) { return s.length > 2; })
        .map(function (s) { try { return JSON.parse(s); } catch (e) { return null; } })
        .filter(Boolean)
        .slice(-RUNS_MAX);
    } catch (e) { return []; }
  }
};
