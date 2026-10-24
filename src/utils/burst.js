// Burst stage flags stored as a Linux-permission-style bitmask on nikkes.burst_type:
// Burst I = 1, Burst II = 2, Burst III = 4. Any combination is their sum (e.g. I+III = 5).
export const BURST_BIT = { 1: 1, 2: 2, 3: 4 };
export const BURST_ALL = 7;

export function hasBurstStage(mask, stage) {
  return (mask & BURST_BIT[stage]) !== 0;
}

export function burstMaskToLabel(mask) {
  if (mask === BURST_ALL) return 'ALL';
  return [1, 2, 3].filter(stage => hasBurstStage(mask, stage)).join(',');
}
