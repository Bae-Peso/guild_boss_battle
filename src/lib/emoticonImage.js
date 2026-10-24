// 채팅 이모티콘 이미지 업로드 유틸. (관리자 전용 — emoticon_images 버킷, 정책은 20261016120000_emoticon_images.sql)
// 채팅 이미지(chatImage.js)와 달리 캔버스로 압축하지 않는다. 다시 인코딩하면 애니메이션이 사라지기 때문.
// 대신 애니메이션 WebP/GIF/APNG 의 반복 횟수를 무한으로 고쳐서 원본 그대로 올린다.

import { supabase } from './supabase';
import { makeInfiniteLoop } from './animLoop';

const BUCKET = 'emoticon_images';
// 버킷의 file_size_limit / allowed_mime_types 와 같은 값.
export const EMOTICON_MAX_BYTES = 5 * 1024 * 1024;
const EXT_BY_MIME = {
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/png': 'png',
  'image/jpeg': 'jpg'
};
export const EMOTICON_ACCEPT = Object.keys(EXT_BY_MIME).join(',');

// 반환: { url, animated, loopFixed }
export async function uploadEmoticonImage(file, packId) {
  const ext = EXT_BY_MIME[file?.type];
  if (!ext) throw new Error(`${file?.name || '파일'}: WebP, GIF, PNG, JPG 파일만 올릴 수 있습니다.`);
  if (file.size > EMOTICON_MAX_BYTES) throw new Error(`${file.name}: 용량이 너무 큽니다. (최대 5MB)`);

  const { blob, animated, changed } = await makeInfiniteLoop(file);
  const path = `${packId}/${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    // 파일명이 매번 새로 생기므로 길게 캐시해도 된다.
    .upload(path, blob, { contentType: file.type, cacheControl: '31536000' });
  if (error) throw error;

  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: publicUrl, animated, loopFixed: changed };
}

// 이 버킷에 올린 파일의 URL 이면 저장소 경로를, 외부 URL 이면 null 을 돌려준다.
function storagePath(url) {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const i = url ? url.indexOf(marker) : -1;
  return i < 0 ? null : decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
}

// 업로드한 이미지 파일을 지운다. 외부 URL 은 건너뛴다. 실패해도 이모티콘 삭제는 막지 않도록 예외를 던지지 않는다.
export async function removeEmoticonImages(urls) {
  const paths = (urls || []).map(storagePath).filter(Boolean);
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) console.error('이모티콘 이미지 삭제 실패:', error);
}
