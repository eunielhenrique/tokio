// SDR Digital - Tebox Diversões — substituto do workflow n8n
// "SDR Digital - Tebox Diversoes v11" (id w1WurrA9lz4653KG).
//
// Recebe o webhook do WhatsApp Cloud API (Meta) e executa todo o funil:
// boas-vindas → entendimento → faixa → objetivo → qualificação (APN / baixo
// potencial / locação) → agente IA de dúvidas → agente IA de agendamento
// (Google Calendar + Meet + Gmail) → CRM (ROI Chat).
//
// Substitui o nó "WhatsApp Trigger" + "Parsear Mensagem" do n8n.

import { processarMensagem, type ParsedMessage } from "./funil.ts";

const VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") ?? "tebox-sdr";

// Réplica do "Parsear Mensagem"
function parsearMensagem(body: Record<string, unknown>): ParsedMessage | null {
  // O payload da Meta vem em entry[].changes[].value
  const entry = (body.entry as Record<string, unknown>[] | undefined)?.[0];
  const change = (entry?.changes as Record<string, unknown>[] | undefined)?.[0];
  const value = (change?.value ?? body) as Record<string, unknown>;

  const messages = value.messages as Record<string, unknown>[] | undefined;
  if (!messages?.length) return null;
  const msg = messages[0];
  const contact = (value.contacts as Record<string, unknown>[] | undefined)?.[0];

  const phone = String(msg.from ?? "");
  const profile = contact?.profile as { name?: string } | undefined;
  const pushName = profile?.name || phone;
  const messageId = String(msg.id ?? `${phone}_${Date.now()}`);

  let messageText = "";
  if (msg.type === "text") {
    messageText = String((msg.text as { body?: string })?.body ?? "").trim();
  } else if (msg.type === "interactive") {
    const i = msg.interactive as Record<string, Record<string, string>> & { type?: string };
    messageText = i.type === "button_reply"
      ? i.button_reply?.title || i.button_reply?.id || ""
      : i.type === "list_reply"
      ? i.list_reply?.title || i.list_reply?.id || ""
      : "";
  }
  if (!messageText || !phone) return null;
  return { phone, pushName, messageText, messageId };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Verificação do webhook pela Meta (GET hub.challenge)
  if (req.method === "GET") {
    if (
      url.searchParams.get("hub.mode") === "subscribe" &&
      url.searchParams.get("hub.verify_token") === VERIFY_TOKEN
    ) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const msg = parsearMensagem(body);
  if (msg) {
    // Responde 200 imediatamente (exigência da Meta) e processa em background.
    // @ts-ignore EdgeRuntime existe no ambiente das Edge Functions do Supabase
    const runtime = globalThis.EdgeRuntime as { waitUntil?: (p: Promise<unknown>) => void } | undefined;
    const task = processarMensagem(msg).catch((e) => console.error("Erro no funil:", e));
    if (runtime?.waitUntil) runtime.waitUntil(task);
    else await task;
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
