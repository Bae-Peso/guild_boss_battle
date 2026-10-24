// 멘션/알림 효과음 재생 (마이페이지 토글·테스트, 실제 멘션 알림 공용).
// alarm_clock.ogg 는 길이가 길어 그대로 두면 알람이 끝까지 울리므로,
// durationMs 가 지나면 자동으로 멈춰 재생 길이를 제어한다.

const MENTION_SOUND_URL = 'https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg';

// 알림음 재생 길이(ms). 이 값만 바꾸면 모든 알림음 길이가 함께 조정된다.
// 0(또는 음수)으로 두면 끊지 않고 원본 길이 그대로 재생한다.
export const MENTION_SOUND_DURATION_MS = 1700;

// 알림음을 재생하고, durationMs 후 자동으로 멈춘다.
// audio.play() 의 Promise 를 그대로 반환하므로, 호출부에서 .catch() 로 재생 실패를 처리할 수 있다.
export function playMentionSound({ volume = 0.8, durationMs = MENTION_SOUND_DURATION_MS } = {}) {
  const audio = new Audio(MENTION_SOUND_URL);
  audio.volume = volume;

  if (durationMs > 0) {
    setTimeout(() => {
      audio.pause();
      audio.currentTime = 0;
    }, durationMs);
  }

  return audio.play();
}
