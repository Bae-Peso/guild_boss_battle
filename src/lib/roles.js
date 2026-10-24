// 길드 관리 권한 여부(길드장 admin 또는 부길드장 sub_admin).
// 흩어져 있던 `role === 'admin' || role === 'sub_admin'` 판정을 한 곳으로 통일한다.
export const isManager = (role) => role === 'admin' || role === 'sub_admin';
