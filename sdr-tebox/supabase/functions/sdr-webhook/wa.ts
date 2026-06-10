// Envio de mensagens via WhatsApp Cloud API (Meta Graph).
// Substitui os nós "HTTP Enviar *", "Enviar Resp CTA APN/Catalogo" e "Enviar Aguarde" do fluxo n8n.

const TOKEN = Deno.env.get("WHATSAPP_TOKEN")!;
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "881902981671358";
const GRAPH_URL = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;

export interface Button {
  id: string;
  title: string;
}

export interface ListRow {
  id: string;
  title: string;
}

async function send(payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(GRAPH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  if (!res.ok) console.error("Envio WhatsApp falhou:", res.status, await res.text());
}

export function sendText(to: string, body: string): Promise<void> {
  return send({ to, type: "text", text: { body } });
}

export function sendButtons(
  to: string,
  body: string,
  buttons: Button[],
  header?: string,
): Promise<void> {
  const interactive: Record<string, unknown> = {
    type: "button",
    body: { text: body },
    action: {
      buttons: buttons.map((b) => ({
        type: "reply",
        reply: { id: b.id, title: b.title.length > 20 ? b.title.slice(0, 20) : b.title },
      })),
    },
  };
  if (header) interactive.header = { type: "text", text: header };
  return send({ to, type: "interactive", interactive });
}

export function sendList(
  to: string,
  body: string,
  buttonLabel: string,
  sectionTitle: string,
  rows: ListRow[],
): Promise<void> {
  return send({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: body },
      action: { button: buttonLabel, sections: [{ title: sectionTitle, rows }] },
    },
  });
}
