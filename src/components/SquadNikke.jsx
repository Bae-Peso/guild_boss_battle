import React from 'react';
import NikkeAvatar from './NikkeAvatar';

// 스쿼드 니케 1기. used면 흑백 처리, battleUsed(실전=완료 타수에서 사용됨)면 빨간 "실전 사용됨" 오버레이.
// 계산기에만 올라간 경우는 흑백만, 실전에 사용된 경우는 흑백 + 빨간 글자로 구분한다.
//
// 지휘 현황판의 대기열/계산기 카드와 모의전 업로드 모달의 "기존 기록 불러오기" 목록이 같은 표기를
// 써야 해서 공용 컴포넌트로 분리했다. (예전엔 현황판에만 있어서, 불러오기 목록에서는 이미 실전에
// 쓴 니케인지 흑백 여부로만 구분해야 했다 — 계산기에만 올린 경우와 헷갈렸다.)
export default function SquadNikke({ nikkeId, used, battleUsed, width = '18%' }) {
  return (
    <div style={{ position: 'relative', width, aspectRatio: '1/1', containerType: 'inline-size' }}>
      <NikkeAvatar nikkeId={nikkeId} size="100%" style={{ width: '100%', height: '100%', filter: used ? 'grayscale(100%) opacity(0.4)' : 'none' }} />
      {battleUsed && (
        <span style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          textAlign: 'center', color: 'var(--danger)', fontWeight: 'bold', lineHeight: 1.05,
          fontSize: 'clamp(6px, 24cqw, 13px)', textShadow: '0 0 2px #000, 0 0 3px #000',
          pointerEvents: 'none', wordBreak: 'keep-all',
        }}>실전<br />사용됨</span>
      )}
    </div>
  );
}
