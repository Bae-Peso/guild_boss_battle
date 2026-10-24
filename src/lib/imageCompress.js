// 업로드 전 클라이언트 이미지 압축.
// 긴 변을 maxDim 이하로 리사이즈하고 WebP(기본)로 재인코딩해 용량/대역폭을 크게 줄인다.
// (Supabase Storage 무료 한도 부담 완화 — 원본 대비 대략 수~십 배 절감)
// 붙여넣기 스크린샷은 대개 PNG라 안전하게 디코드된다. iOS HEIC 등은 브라우저 디코드 한계가 있어
// 실패하면 예외를 던지고, 호출측(uploadChatImage)에서 사용자에게 안내한다.

export async function compressImage(file, { maxDim = 1600, quality = 0.8, mime = 'image/webp' } = {}) {
  const bitmap = await loadBitmap(file);
  const width = bitmap.naturalWidth || bitmap.width;
  const height = bitmap.naturalHeight || bitmap.height;

  const scale = Math.min(1, maxDim / Math.max(width, height));
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  if (typeof bitmap.close === 'function') bitmap.close();

  let blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
  // 브라우저가 요청 포맷을 지원하지 않아 null 이면 PNG 로 폴백
  if (!blob) {
    blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }
  if (!blob) throw new Error('이미지 압축에 실패했습니다.');
  return blob;
}

async function loadBitmap(file) {
  // createImageBitmap 이 있으면 우선 사용(빠르고 메모리 효율적)
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // 일부 포맷은 실패할 수 있어 <img> 로 폴백
    }
  }
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 불러올 수 없습니다.')); };
    img.src = url;
  });
}
