import { useState, useCallback } from 'react';
import { uploadChatImage } from '../lib/chatImage';

// 체험 모드에서는 실제 Storage 업로드 대신 로컬 objectURL로 미리보기만(비영구).
const isDemoSession = () => {
  try { return sessionStorage.getItem('nikke_demo') === '1'; } catch { return false; }
};

// 채팅 입력창 클립보드 붙여넣기 → 자동 업로드 → 미리보기용 URL 관리. (일반/지휘 채팅 공용)
// - handlePaste: 붙여넣기 이벤트에서 이미지면 업로드, 아니면 기본 텍스트 붙여넣기를 그대로 둔다.
// - pendingImageUrl / uploading: 입력창 위 미리보기 칩 렌더에 사용.
// - clearPending: 첨부 제거 또는 전송 후 초기화.
export function useChatImageUpload() {
  const [pendingImageUrl, setPendingImageUrl] = useState(null);
  const [uploading, setUploading] = useState(false);

  const uploadBlob = useCallback(async (blob) => {
    if (isDemoSession()) {
      setPendingImageUrl(URL.createObjectURL(blob));
      return;
    }
    setUploading(true);
    try {
      const url = await uploadChatImage(blob);
      setPendingImageUrl(url);
    } catch (err) {
      console.error(err);
      alert(err?.message || '이미지 업로드에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  }, []);

  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItem = [...items].find((it) => it.type && it.type.startsWith('image/'));
    if (!imageItem) return; // 이미지가 아니면 기본 텍스트 붙여넣기 유지
    const blob = imageItem.getAsFile();
    if (!blob) return;
    e.preventDefault();
    uploadBlob(blob);
  }, [uploadBlob]);

  const clearPending = useCallback(() => setPendingImageUrl(null), []);

  return { pendingImageUrl, uploading, handlePaste, clearPending };
}
