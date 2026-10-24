// 애니메이션 이미지의 반복 횟수를 "무한"으로 고쳐 쓴다. (이모티콘 업로드용)
//
// 애니메이션 WebP/GIF/APNG 는 몇 번 반복할지가 파일 안에 숫자로 들어 있다. 외부 사이트에서 받은
// 이모티콘은 이 값이 3 같은 유한값이라 몇 번 돌고 멈춘다. 캔버스로 다시 인코딩하면 애니메이션이
// 사라지므로, 픽셀은 건드리지 않고 그 숫자만 0(무한)으로 바꾼다.
//   - WebP : ANIM 청크의 loop count (2바이트, LE)
//   - GIF  : NETSCAPE2.0 확장의 loop count (2바이트, LE). 확장이 없으면 브라우저는 1회만 재생하므로 새로 넣는다.
//   - APNG : acTL 청크의 num_plays (4바이트, BE) + 청크 CRC 재계산
// 정지 이미지(JPG, 일반 PNG/WebP)는 그대로 돌려준다.

const ascii = (bytes, start, len) => String.fromCharCode(...bytes.subarray(start, start + len));

// ── WebP ────────────────────────────────────────────────────────────────────
function fixWebp(bytes) {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const fourcc = ascii(bytes, pos, 4);
    const size = view.getUint32(pos + 4, true);
    if (fourcc === 'ANIM' && size >= 6 && pos + 14 <= bytes.length) {
      const loopPos = pos + 8 + 4; // 배경색 4바이트 다음
      const before = view.getUint16(loopPos, true);
      if (before === 0) return { animated: true, changed: false, bytes };
      const out = bytes.slice();
      out[loopPos] = 0;
      out[loopPos + 1] = 0;
      return { animated: true, changed: true, before, bytes: out };
    }
    pos += 8 + size + (size & 1);
  }
  return { animated: false, changed: false, bytes };
}

// ── GIF ─────────────────────────────────────────────────────────────────────
function skipSubBlocks(bytes, pos) {
  while (pos < bytes.length) {
    const len = bytes[pos];
    pos += 1;
    if (len === 0) return pos;
    pos += len;
  }
  return -1;
}

function fixGif(bytes) {
  const sig = bytes.length >= 13 ? ascii(bytes, 0, 6) : '';
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null;

  const packed = bytes[10];
  const headerEnd = 13 + ((packed & 0x80) ? 3 * (1 << ((packed & 0x07) + 1)) : 0);
  let pos = headerEnd;
  let frames = 0;
  let loopPos = -1;

  while (pos < bytes.length) {
    const block = bytes[pos];
    if (block === 0x3b) break; // trailer
    if (block === 0x21) {
      const label = bytes[pos + 1];
      if (label === 0xff && bytes[pos + 2] === 11) {
        const id = ascii(bytes, pos + 3, 11);
        const sub = pos + 14;
        if ((id === 'NETSCAPE2.0' || id === 'ANIMEXTS1.0') && bytes[sub] >= 3 && bytes[sub + 1] === 1) {
          loopPos = sub + 2;
        }
      }
      pos = skipSubBlocks(bytes, pos + 2);
    } else if (block === 0x2c) {
      frames += 1;
      const imgPacked = bytes[pos + 9];
      pos += 10;
      if (imgPacked & 0x80) pos += 3 * (1 << ((imgPacked & 0x07) + 1));
      pos = skipSubBlocks(bytes, pos + 1); // LZW 최소 코드 크기 1바이트 다음부터 데이터
    } else {
      break; // 알 수 없는 블록: 손상된 파일. 여기까지만 본다.
    }
    if (pos < 0) break;
  }

  if (loopPos >= 0) {
    const before = bytes[loopPos] | (bytes[loopPos + 1] << 8);
    if (before === 0) return { animated: frames > 1, changed: false, bytes };
    const out = bytes.slice();
    out[loopPos] = 0;
    out[loopPos + 1] = 0;
    return { animated: frames > 1, changed: true, before, bytes: out };
  }
  if (frames <= 1) return { animated: false, changed: false, bytes };

  // NETSCAPE 확장이 없는 애니메이션 GIF → 1회 재생. 전역 색상표 바로 뒤에 무한 반복 확장을 넣는다.
  const ext = new Uint8Array([
    0x21, 0xff, 0x0b,
    ...Array.from('NETSCAPE2.0', c => c.charCodeAt(0)),
    0x03, 0x01, 0x00, 0x00, 0x00
  ]);
  const out = new Uint8Array(bytes.length + ext.length);
  out.set(bytes.subarray(0, headerEnd), 0);
  out.set(ext, headerEnd);
  out.set(bytes.subarray(headerEnd), headerEnd + ext.length);
  out.set([0x38, 0x39], 3); // 확장 블록은 GIF89a 부터 정의되어 있다
  return { animated: true, changed: true, before: 1, bytes: out };
}

// ── APNG ────────────────────────────────────────────────────────────────────
let crcTable = null;
function crc32(bytes, start, end) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function fixPng(bytes) {
  if (bytes.length < 8 || PNG_SIG.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const len = view.getUint32(pos);
    const type = ascii(bytes, pos + 4, 4);
    if (type === 'IDAT') break; // acTL 은 IDAT 앞에만 올 수 있다
    if (type === 'acTL' && len === 8 && pos + 20 <= bytes.length) {
      const playsPos = pos + 8 + 4;
      const before = view.getUint32(playsPos);
      if (before === 0) return { animated: true, changed: false, bytes };
      const out = bytes.slice();
      const outView = new DataView(out.buffer);
      outView.setUint32(playsPos, 0);
      outView.setUint32(pos + 8 + len, crc32(out, pos + 4, pos + 8 + len));
      return { animated: true, changed: true, before, bytes: out };
    }
    pos += 12 + len;
  }
  return { animated: false, changed: false, bytes };
}

// Uint8Array → { animated, changed, before?, bytes }
export function setInfiniteLoop(bytes) {
  return fixWebp(bytes) || fixGif(bytes) || fixPng(bytes) || { animated: false, changed: false, bytes };
}

// File/Blob → { blob, animated, changed, before? }. 내용으로 형식을 판별하고, 원래 MIME 타입을 유지한다.
export async function makeInfiniteLoop(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = setInfiniteLoop(bytes);
  const blob = result.changed ? new Blob([result.bytes], { type: file.type }) : file;
  return { blob, animated: result.animated, changed: result.changed, before: result.before };
}
