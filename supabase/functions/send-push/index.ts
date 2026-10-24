// user_notifications INSERT Database Webhook → 해당 유저의 모든 기기로 Web Push 발송
// 배포: supabase functions deploy send-push --no-verify-jwt
// (Webhook은 유저 JWT를 보내지 않으므로 x-push-secret 헤더로 인증)
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  ApplicationServer,
  importVapidKeys,
  PushMessageError,
  Urgency,
} from "jsr:@negrel/webpush@0.3.0";

const vapidKeys = await importVapidKeys(
  JSON.parse(Deno.env.get("VAPID_KEYS_JWK")!),
  { extractable: false },
);

const appServer = await ApplicationServer.new({
  contactInformation: Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
  vapidKeys,
});

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.headers.get("x-push-secret") !== Deno.env.get("PUSH_WEBHOOK_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }

  let payload: { type?: string; record?: Record<string, unknown> };
  try {
    payload = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const record = payload.record as
    | { id: string; user_id: string; message: string; type: string }
    | undefined;
  if (payload.type !== "INSERT" || !record?.user_id) {
    return new Response("ignored");
  }

  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", record.user_id);

  if (error) {
    console.error("subscription query failed:", error.message);
    return new Response("db error", { status: 500 });
  }

  const body = JSON.stringify({
    title: "길드 보스전 지휘소",
    body: record.message,
    tag: `notif-${record.id}`,
    url: "/workspace",
    type: record.type,
  });

  const results = await Promise.allSettled(
    (subs ?? []).map(async (s) => {
      const subscriber = appServer.subscribe({
        endpoint: s.endpoint,
        keys: { p256dh: s.p256dh, auth: s.auth },
      });
      try {
        await subscriber.pushTextMessage(body, {
          urgency: Urgency.High,
          ttl: 3600,
        });
      } catch (err) {
        // 만료/해지된 구독(404/410)은 정리하고, 그 외 오류는 로그만 남김
        if (
          err instanceof PushMessageError &&
          (err.isGone() || err.response.status === 404)
        ) {
          await admin.from("push_subscriptions").delete().eq("id", s.id);
          return;
        }
        console.error(`push failed for sub ${s.id}:`, String(err));
        throw err;
      }
    }),
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  return new Response(JSON.stringify({ ok: true, sent, total: subs?.length ?? 0 }), {
    headers: { "content-type": "application/json" },
  });
});
