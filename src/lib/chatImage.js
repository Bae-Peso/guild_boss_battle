// 채팅 이미지 업로드 유틸. (일반/지휘 채팅 공용)
// 파일 또는 Blob(클립보드 이미지 포함)을 압축한 뒤 chat_images 버킷에 올리고 public URL을 반환한다.
// 저장 패턴은 NikkeManagement 의 storage.upload + getPublicUrl + 랜덤 파일명과 동일하다.

import { supabase } from './supabase';
import { compressImage } from './imageCompress';

const BUCKET = 'chat_images';
// 압축 전 입력 용량 가드(무료 버킷 업로드 상한 50MB보다 훨씬 낮게).
const MAX_INPUT_BYTES = 15 * 1024 * 1024;

export async function uploadChatImage(fileOrBlob) {
  if (!fileOrBlob || !fileOrBlob.type || !fileOrBlob.type.startsWith('image/')) {
    throw new Error('이미지 파일만 업로드할 수 있습니다.');
  }
  if (fileOrBlob.size > MAX_INPUT_BYTES) {
    throw new Error('이미지 용량이 너무 큽니다. (최대 15MB)');
  }

  const blob = await compressImage(fileOrBlob);
  const ext = blob.type === 'image/png' ? 'png' : 'webp';
  const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, blob, { contentType: blob.type, cacheControl: '3600' });
  if (uploadError) throw uploadError;

  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
  return publicUrl;
}
