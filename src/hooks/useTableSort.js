import { useState, useMemo } from 'react';

// 점 표기 경로(예: 'unions.name')를 지원하는 값 접근자.
function getByPath(obj, path) {
  if (!path) return undefined;
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

/**
 * 테이블 클라이언트 정렬을 위한 공용 훅.
 *
 * @param {Array} items - 정렬 대상 배열(보통 검색 필터를 먼저 적용한 결과)
 * @param {Object} [options]
 * @param {string|null} [options.initialField] - 초기 정렬 컬럼
 * @param {'asc'|'desc'} [options.initialDir] - 초기 정렬 방향
 * @param {Object} [options.accessors] - 컬럼 키 → 값 추출 함수. 조인/파생 컬럼에 사용.
 * @returns {{ sorted: Array, sortField: string|null, sortDir: string, handleSort: (field:string)=>void }}
 */
export function useTableSort(items, { initialField = null, initialDir = 'asc', accessors = {} } = {}) {
  const [sortField, setSortField] = useState(initialField);
  const [sortDir, setSortDir] = useState(initialDir);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sorted = useMemo(() => {
    if (!sortField) return items;
    const read = (row) => (accessors[sortField] ? accessors[sortField](row) : getByPath(row, sortField));
    const arr = [...items];
    arr.sort((a, b) => {
      let valA = read(a);
      let valB = read(b);
      // 빈 값은 방향과 무관하게 항상 맨 아래로 보낸다.
      const aEmpty = valA === null || valA === undefined || valA === '';
      const bEmpty = valB === null || valB === undefined || valB === '';
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();
      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [items, sortField, sortDir, accessors]);

  return { sorted, sortField, sortDir, handleSort };
}
