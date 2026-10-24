// VAPID 키 1회 생성 스크립트 (Deno 필요)
// 실행: deno run -A scripts/gen-vapid.ts
//
// 출력된 값을 각각 설정:
//  - VAPID_KEYS_JWK  → supabase secrets set VAPID_KEYS_JWK='<json>'
//  - VITE_VAPID_PUBLIC_KEY → 로컬 .env + 프로덕션 호스트 env 설정
//
// ⚠️ 키를 새로 만들면 기존 푸시 구독이 전부 무효화됩니다. JWK를 안전하게 보관하세요.
import { exportVapidKeys, generateVapidKeys } from "jsr:@negrel/webpush@0.3.0";

const keys = await generateVapidKeys({ extractable: true });
const jwk = await exportVapidKeys(keys);
console.log("VAPID_KEYS_JWK=" + JSON.stringify(jwk));

// 브라우저 pushManager.subscribe()의 applicationServerKey: P-256 공개키 raw(65바이트) → base64url
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
const b64url = btoa(String.fromCharCode(...raw))
  .replaceAll("+", "-")
  .replaceAll("/", "_")
  .replace(/=+$/, "");
console.log("VITE_VAPID_PUBLIC_KEY=" + b64url);
