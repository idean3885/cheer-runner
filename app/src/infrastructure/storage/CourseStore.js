// 코스와 달리기 기록 저장.
//
// 기기에만 둔다. 서버가 없어서가 아니라 이 도메인에 서버가 필요하지 않기 때문이다.
// 코스는 러너 한 사람의 것이고 남과 견주는 일은 다른 컨텍스트다.
//
// 쓰기 실패를 삼키지 않고 알린다. 기록과 달리 코스는 사용자가 만든 것이라
// 조용히 사라지면 안 된다.

import { File, Paths } from 'expo-file-system';

const COURSE = 'course.json';
const SHELF = 'courses.json';
const RUNS = 'runs.jsonl';
const RUNS_MAX = 50;

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
