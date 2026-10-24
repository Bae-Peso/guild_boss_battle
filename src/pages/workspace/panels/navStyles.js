/**
 * 지휘 탭 네비 항목 공통 스타일.
 * '지휘' 카테고리의 링크와 '기록 조회'의 결산 링크가 같은 모양이어야 해서 한 곳에 둔다
 * (결산은 예전엔 노란 강조 버튼이었지만, 특별 취급할 이유가 없어 일반 항목과 통일했다).
 */
export const navLinkStyle = {
  textDecoration: 'none',
  color: 'var(--text-strong)',
  display: 'block',
  padding: '8px 12px',
  backgroundColor: 'var(--surface-4)',
  borderRadius: '4px',
};
