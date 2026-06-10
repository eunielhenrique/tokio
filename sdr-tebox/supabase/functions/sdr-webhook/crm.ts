// Integração com o CRM (ROI Chat) — substitui os nós "Enviar CRM Catalogo",
// "Enviar CRM Locação", "HTTP CRM Faixa" e "HTTP CRM Baixo Potencial" do fluxo n8n.

const CRM_WEBHOOK_URL = Deno.env.get("CRM_WEBHOOK_URL") ??
  "https://roichatpartner.com.br/api/iwh/246da07376f77016aafb0b9d66593dfd";

export async function enviarCRM(payload: {
  nome: string;
  telefone: string;
  interesse: string;
  faixa?: string;
  objetivo?: string;
}): Promise<void> {
  try {
    const res = await fetch(CRM_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error("Envio CRM falhou:", res.status, await res.text());
  } catch (e) {
    console.error("Envio CRM erro:", e);
  }
}
