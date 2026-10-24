// 테이블 정렬/검색을 위한 공용 프레젠테이션 컴포넌트.
// useTableSort 훅과 함께 사용한다.

// 클릭하면 해당 컬럼으로 정렬되는 <th>.
// sort 객체(useTableSort 반환값)를 그대로 넘긴다. className/style은 기존 테이블 스타일과
// 어우러지도록 그대로 통과시킨다.
export function SortableTh({ field, sort, children, className, style, ...rest }) {
  const active = sort.sortField === field;
  return (
    <th
      {...rest}
      className={className}
      onClick={() => sort.handleSort(field)}
      style={{ cursor: 'pointer', userSelect: 'none', ...style }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        {children}
        <span
          style={{
            fontSize: '0.7rem',
            lineHeight: 1,
            color: active ? 'var(--accent-green)' : 'var(--text-dim)',
            opacity: active ? 1 : 0.4,
          }}
        >
          {active ? (sort.sortDir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </span>
    </th>
  );
}

// 테이블 상단 전역 검색 입력창.
export function TableSearchInput({ value, onChange, placeholder = '검색...', className, style }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
      style={{
        padding: '6px 12px',
        borderRadius: '4px',
        border: '1px solid var(--border-2)',
        backgroundColor: 'var(--border-color)',
        color: 'var(--text-strong)',
        ...style,
      }}
    />
  );
}
