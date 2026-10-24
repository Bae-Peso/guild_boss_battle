// 채팅 이미지 전체화면 보기. (일반/지휘 채팅 공용)
export default function ImageLightbox({ src, onClose }) {
  if (!src) return null;
  return (
    <div
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <img src={src} alt="Fullscreen" referrerPolicy="no-referrer" style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }} />
      <button
        style={{ position: 'absolute', top: '20px', right: '30px', background: 'none', border: 'none', color: 'var(--text-strong)', fontSize: '2rem', cursor: 'pointer' }}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >
        ✕
      </button>
    </div>
  );
}
