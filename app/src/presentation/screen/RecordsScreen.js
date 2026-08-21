// 기록 화면. 뛴 것을 돌아보는 자리다.
//
// 모든 달리기는 코스 유무와 무관하게 기록으로 남는다 (ADR 0013). 여기서 그 전부를 본다.
// 목록과 상세 둘뿐이고 판단은 없다. 기록을 읽어 그린다.
//
// 이 결정 이전의 기록에는 경로가 없다. 그 상세는 경로 없음으로 표시한다.

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { runSession } from '../../application/wiring';
import { COLOR } from '../theme';
import { fmtDur, fmtPace, fmtWhen, splitText } from '../format';

// 경로 조각을 다 담는 지도 영역. 여백을 조금 두고, 너무 좁으면 최소 폭을 지킨다
function regionOf(path) {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  (path || []).forEach(function (seg) {
    seg.forEach(function (p) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    });
  });
  if (!isFinite(minLat)) return null;
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max(0.004, (maxLat - minLat) * 1.4),
    longitudeDelta: Math.max(0.004, (maxLon - minLon) * 1.4)
  };
}

export function RecordsScreen(props) {
  // 열 때 한 번 읽는다. 이 화면에 있는 동안 기록이 늘어날 일은 없다
  const [records] = useState(function () { return runSession.records(); });
  const [openIdx, setOpenIdx] = useState(null);

  if (openIdx != null) {
    return <Detail r={records[openIdx]} onBack={function () { setOpenIdx(null); }} />;
  }
  return (
    <View style={s.root}>
      <View style={s.head}>
        <Text style={s.title}>기록</Text>
        <Pressable onPress={props.onClose} hitSlop={10}>
          <Text style={s.close}>닫기</Text>
        </Pressable>
      </View>
      {records.length === 0 ? (
        <Text style={s.empty}>아직 기록이 없습니다. 달리기를 마치면 여기 남습니다.</Text>
      ) : (
        <ScrollView>
          {records.map(function (r, i) {
            return (
              <Pressable key={'r' + i} style={s.row} onPress={function () { setOpenIdx(i); }}>
                <View style={s.rowLeft}>
                  <Text style={s.rowK} numberOfLines={1}>
                    {fmtWhen(r.startedAt)}{r.courseName ? ' · ' + r.courseName : ''}
                  </Text>
                  <Text style={s.rowV}>
                    {(r.dist / 1000).toFixed(2)}km · {fmtDur(r.ms)} · 평균 {fmtPace(r.pace)}
                  </Text>
                </View>
                <Text style={s.chev}>보기</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

function Detail(props) {
  const r = props.r;
  const region = regionOf(r.path);
  return (
    <View style={s.root}>
      <View style={s.head}>
        <Text style={s.title}>{fmtWhen(r.startedAt)}</Text>
        <Pressable onPress={props.onBack} hitSlop={10}>
          <Text style={s.close}>목록</Text>
        </Pressable>
      </View>
      <Text style={s.sum}>
        {(r.dist / 1000).toFixed(2)}km · {fmtDur(r.ms)} · 평균 {fmtPace(r.pace)}
        {r.courseName ? ' · ' + r.courseName : ''}
      </Text>
      <View style={s.mapBox}>
        {region ? (
          <MapView style={s.map} provider={PROVIDER_DEFAULT} initialRegion={region}>
            {r.path.map(function (seg, i) {
              return (
                <Polyline key={'p' + i} strokeColor={COLOR.path} strokeWidth={4}
                  coordinates={seg.map(function (pt) {
                    return { latitude: pt.lat, longitude: pt.lon };
                  })} />
              );
            })}
          </MapView>
        ) : (
          <View style={s.mapWait}>
            <Text style={s.empty}>이 기록에는 경로가 남아 있지 않습니다.</Text>
          </View>
        )}
      </View>
      <Text style={s.h2}>구간</Text>
      {(r.splits || []).length === 0 ? (
        <Text style={s.empty}>구간 기록이 없습니다. 지점을 지나면 구간이 남습니다.</Text>
      ) : (
        <ScrollView style={s.list}>
          {r.splits.map(function (sp, i) {
            return <Text key={'s' + i} style={s.split}>{splitText(sp)}</Text>;
          })}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  title: { fontSize: 24, fontWeight: '800', color: COLOR.ink },
  close: { fontSize: 15, fontWeight: '700', color: COLOR.run },
  empty: { marginTop: 10, fontSize: 12, color: COLOR.inkSoft, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10,
    paddingHorizontal: 12, borderRadius: 12, marginTop: 8,
    backgroundColor: COLOR.card, borderWidth: 1, borderColor: COLOR.cardLine },
  rowLeft: { flex: 1 },
  rowK: { fontSize: 14.5, fontWeight: '700', color: COLOR.ink },
  rowV: { marginTop: 2, fontSize: 12, color: COLOR.inkSoft, fontVariant: ['tabular-nums'] },
  chev: { fontSize: 13, fontWeight: '700', color: COLOR.run },
  sum: { marginTop: 8, fontSize: 13.5, fontWeight: '600', color: COLOR.ink,
    fontVariant: ['tabular-nums'] },
  mapBox: { flex: 1, marginTop: 10, borderRadius: 14, overflow: 'hidden',
    backgroundColor: COLOR.mapWait },
  map: { flex: 1 },
  mapWait: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  h2: { marginTop: 12, fontSize: 13, fontWeight: '700', color: COLOR.ink },
  list: { maxHeight: 170, marginTop: 4, marginBottom: 10 },
  split: { fontSize: 12, color: COLOR.ok, paddingVertical: 3, fontVariant: ['tabular-nums'] }
});
