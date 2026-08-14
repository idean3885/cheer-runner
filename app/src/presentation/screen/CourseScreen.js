// 코스 화면. 저장한 코스를 고르고 지우는 자리다.
//
// 목록이 짧다. 마지막 한 칸과 저장 두 칸이 전부다. 그래서 검색도 접기도 두지 않는다.
//
// 여기서 하는 일은 넷이다. 지금 코스에 이름을 붙여 저장하고, 저장한 것을 불러오고,
// 하나를 지우고, 코스 없이 달리기로 되돌린다.
//
// 판단은 없다. 칸이 찼는지도 무엇을 지울지도 세션과 도메인이 갖는다.

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { runSession } from '../../application/wiring';
import { COLOR } from '../theme';
import { SAVED_MAX } from '../../domain/constants';

function fmtKm(m) {
  return (m / 1000).toFixed(2) + 'km';
}

// 언제 저장한 것인지. 날짜만으로는 오늘 두 번 달린 것을 가를 수 없다
function fmtWhen(at) {
  if (!at) return '';
  const d = new Date(at);
  const two = function (n) { return (n < 10 ? '0' : '') + n; };
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
}

export function CourseScreen(props) {
  const [v, setV] = useState(runSession.view());
  const [name, setName] = useState('');
  const [notice, setNotice] = useState(null);

  function refresh() { setV(runSession.view()); }

  const shelf = v.shelf || [];
  const last = shelf.filter(function (c) { return c.slot === 'last'; });
  const saved = shelf.filter(function (c) { return c.slot === 'saved'; });
  const hasCurrent = v.spots.length > 0 || v.hasCourse;

  function onSave() {
    const r = runSession.saveCourse(name.trim());
    if (r.ok) {
      setName('');
      setNotice('저장했습니다. ' + (r.replaced ? '같은 코스를 갱신했습니다' : '이 코스는 다음에 그대로 불러옵니다'));
    } else if (r.reason === 'shelf-full') {
      setNotice('저장 칸이 ' + r.limit + '개까지입니다. 아래에서 하나를 지우고 다시 저장해 주세요');
    } else if (r.reason === 'empty-course') {
      setNotice('아직 저장할 것이 없습니다. 한 번 달리면 그 경로가 코스가 됩니다');
    } else {
      setNotice('저장하지 못했습니다');
    }
    refresh();
  }

  function onLoad(id) {
    const r = runSession.loadCourse(id);
    if (!r.ok) {
      setNotice(r.reason === 'running'
        ? '달리는 중에는 코스를 바꿀 수 없습니다. 먼저 종료해 주세요'
        : '불러오지 못했습니다');
      refresh();
      return;
    }
    // 불러왔으면 달리기 화면으로 되돌린다. 고른 뒤에 할 일은 달리는 것이다
    if (props.onClose) props.onClose();
  }

  function onRemove(id) {
    runSession.removeCourse(id);
    setNotice('지웠습니다');
    refresh();
  }

  function onClear() {
    if (!runSession.clearCourse()) {
      setNotice('달리는 중에는 바꿀 수 없습니다');
      refresh();
      return;
    }
    if (props.onClose) props.onClose();
  }

  return (
    <View style={s.root}>
      <View style={s.head}>
        <Text style={s.title}>코스</Text>
        <Pressable onPress={props.onClose} hitSlop={10}>
          <Text style={s.close}>닫기</Text>
        </Pressable>
      </View>

      {notice ? <Text style={s.notice}>{notice}</Text> : null}

      <ScrollView>
        <Text style={s.h2}>지금 코스</Text>
        <View style={s.card}>
          <Text style={s.cardK}>
            {v.courseName ? v.courseName : '이름 없음'}
            <Text style={s.cardSub}>{'  지점 ' + v.spots.length + '곳'}</Text>
          </Text>
          {hasCurrent ? (
            <View style={s.saveRow}>
              <TextInput style={s.input} value={name} onChangeText={setName}
                placeholder="이름 (예: 한강 언덕)" placeholderTextColor={COLOR.inkFaint}
                maxLength={20} returnKeyType="done" onSubmitEditing={onSave} />
              <Pressable style={s.btn} onPress={onSave}>
                <Text style={s.btnText}>저장</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={s.empty}>아직 코스가 없습니다. 한 번 달리면 그 경로가 코스가 됩니다.</Text>
          )}
        </View>

        <Text style={s.h2}>마지막 달리기</Text>
        {last.length === 0 ? (
          <Text style={s.empty}>달리기를 마치면 그 코스가 여기 남습니다. 저장을 누르지 않아도 남습니다.</Text>
        ) : last.map(function (c) {
          return <Row key={c.id} course={c} onLoad={onLoad} onRemove={onRemove} />;
        })}

        <Text style={s.h2}>저장한 코스 {saved.length}/{SAVED_MAX}</Text>
        {saved.length === 0 ? (
          <Text style={s.empty}>이름을 붙여 저장한 코스가 여기 쌓입니다.</Text>
        ) : saved.map(function (c) {
          return <Row key={c.id} course={c} onLoad={onLoad} onRemove={onRemove} />;
        })}

        <Pressable style={s.plain} onPress={onClear}>
          <Text style={s.plainText}>코스 없이 달리기</Text>
        </Pressable>
        <Text style={s.foot}>
          기기에만 저장합니다. 그래서 마지막 한 개와 저장 두 개까지만 둡니다.
        </Text>
      </ScrollView>
    </View>
  );
}

function Row(props) {
  const c = props.course;
  return (
    <View style={[s.row, c.current ? s.rowOn : null]}>
      <View style={s.rowLeft}>
        <Text style={s.rowK} numberOfLines={1}>
          {c.name || (c.slot === 'last' ? '마지막 달리기' : '이름 없음')}
          {c.current ? <Text style={s.badge}>{'  지금 코스'}</Text> : null}
        </Text>
        <Text style={s.rowV}>
          {'지점 ' + c.spots + '곳 · ' + fmtKm(c.dist) + (c.savedAt ? ' · ' + fmtWhen(c.savedAt) : '')}
        </Text>
      </View>
      <Pressable style={s.btn} onPress={function () { props.onLoad(c.id); }}>
        <Text style={s.btnText}>불러오기</Text>
      </Pressable>
      <Pressable onPress={function () { props.onRemove(c.id); }} hitSlop={8}>
        <Text style={s.del}>지우기</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  title: { fontSize: 24, fontWeight: '800', color: COLOR.ink },
  close: { fontSize: 15, fontWeight: '700', color: COLOR.run },
  notice: { marginTop: 8, fontSize: 12.5, lineHeight: 18, color: COLOR.warn },
  h2: { marginTop: 18, marginBottom: 6, fontSize: 13, fontWeight: '700', color: COLOR.ink },
  card: { backgroundColor: COLOR.card, borderWidth: 1, borderColor: COLOR.cardLine,
    borderRadius: 12, padding: 12 },
  cardK: { fontSize: 15, fontWeight: '700', color: COLOR.ink },
  cardSub: { fontSize: 12, fontWeight: '500', color: COLOR.inkSoft },
  saveRow: { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#ffffff', borderRadius: 9, borderWidth: 1,
    borderColor: COLOR.divider, paddingHorizontal: 10, paddingVertical: 9,
    fontSize: 14, color: COLOR.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10,
    paddingHorizontal: 12, borderRadius: 12, marginBottom: 8,
    backgroundColor: COLOR.card, borderWidth: 1, borderColor: COLOR.cardLine },
  rowOn: { borderColor: COLOR.run },
  rowLeft: { flex: 1 },
  rowK: { fontSize: 14.5, fontWeight: '700', color: COLOR.ink },
  badge: { fontSize: 11, fontWeight: '700', color: COLOR.run },
  rowV: { marginTop: 2, fontSize: 11.5, color: COLOR.inkSoft },
  btn: { backgroundColor: COLOR.run, borderRadius: 9, paddingVertical: 8, paddingHorizontal: 12 },
  btnText: { fontSize: 13, fontWeight: '700', color: COLOR.onDark },
  del: { fontSize: 12, color: COLOR.danger },
  empty: { fontSize: 12, color: COLOR.inkSoft, lineHeight: 18 },
  plain: { marginTop: 22, alignItems: 'center', paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: COLOR.divider },
  plainText: { fontSize: 14, fontWeight: '700', color: COLOR.inkSoft },
  foot: { marginTop: 12, marginBottom: 24, fontSize: 11.5, color: COLOR.inkFaint, lineHeight: 17 }
});
