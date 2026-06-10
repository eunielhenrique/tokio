// Acesso ao Supabase (REST) — tabela sdr_leads e memória de chat dos agentes.
// Substitui os nós: "Buscar Lead Supabase1", "Criar Lead", "Atualizar Lead BV",
// "Salvar Entendimento/Faixa/Objetivo/CTA *", "Salvar Caminho Agendamento",
// "Postgres Chat Memory1" e "Memoria Agendamento" do fluxo n8n.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

export interface Lead {
  phone: string;
  push_name?: string | null;
  current_step?: string | null;
  tipo_interesse?: string | null;
  faixa_investimento?: string | null;
  objetivo?: string | null;
  cta_escolha?: string | null;
  horario_preferido?: string | null;
  last_message_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export async function getLead(phone: string): Promise<Lead | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/sdr_leads?phone=eq.${encodeURIComponent(phone)}&limit=1`,
    { headers },
  );
  if (!res.ok) {
    console.error("getLead falhou:", res.status, await res.text());
    return null;
  }
  const rows = await res.json();
  return rows[0] ?? null;
}

export async function createLead(fields: Partial<Lead>): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/sdr_leads`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify(fields),
  });
  if (!res.ok) console.error("createLead falhou:", res.status, await res.text());
}

export async function updateLead(phone: string, fields: Partial<Lead>): Promise<void> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/sdr_leads?phone=eq.${encodeURIComponent(phone)}`,
    {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify(fields),
    },
  );
  if (!res.ok) console.error("updateLead falhou:", res.status, await res.text());
}

// ---- Memória de chat (substitui as tabelas n8n_chat_ia_duvidas / n8n_chat_agendamento) ----

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export async function memGet(sessionId: string, limit = 40): Promise<ChatMsg[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/sdr_chat_memory?session_id=eq.${encodeURIComponent(sessionId)}&order=id.desc&limit=${limit}`,
    { headers },
  );
  if (!res.ok) {
    console.error("memGet falhou:", res.status, await res.text());
    return [];
  }
  const rows = await res.json();
  return rows.reverse().map((r: { role: string; content: string }) => ({
    role: r.role as "user" | "assistant",
    content: r.content,
  }));
}

export async function memAppend(sessionId: string, role: string, content: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/sdr_chat_memory`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ session_id: sessionId, role, content }),
  });
  if (!res.ok) console.error("memAppend falhou:", res.status, await res.text());
}
