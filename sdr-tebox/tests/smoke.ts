// Teste do funil com APIs mockadas. Rodar: cd ../supabase/functions/sdr-webhook && bun ../../../tests/smoke.ts
// Smoke test: simula o funil com fetch mockado
const calls: {url:string, method:string, body?:string}[] = [];
let leadRow: Record<string, unknown> | null = null;

(globalThis as any).Deno = {
  env: { get: (k: string) => ({
    SUPABASE_URL: "http://sb", SUPABASE_SERVICE_ROLE_KEY: "key",
    WHATSAPP_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: "123",
    OPENAI_API_KEY: "sk", META_VERIFY_TOKEN: "vt",
    GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "g", GOOGLE_REFRESH_TOKEN: "g",
  } as Record<string,string>)[k] },
  serve: (_h: unknown) => {},
};

(globalThis as any).fetch = async (url: string, init?: RequestInit) => {
  const method = init?.method ?? "GET";
  const body = init?.body as string | undefined;
  calls.push({ url, method, body });
  if (url.startsWith("http://sb/rest/v1/sdr_leads") && method === "GET") {
    return new Response(JSON.stringify(leadRow ? [leadRow] : []), { status: 200 });
  }
  if (url.includes("sdr_chat_memory") && method === "GET") {
    return new Response("[]", { status: 200 });
  }
  return new Response("{}", { status: 200 });
};

const { processarMensagem } = await import("../supabase/functions/sdr-webhook/funil.ts");

function waCalls() { return calls.filter(c => c.url.includes("graph.facebook")).map(c => JSON.parse(c.body!)); }
function sbWrites() { return calls.filter(c => c.url.includes("sdr_leads") && c.method !== "GET"); }

// 1) Lead novo manda "oi" → boas-vindas com botão
calls.length = 0; leadRow = null;
await processarMensagem({ phone: "5511999", pushName: "Teste", messageText: "oi", messageId: "m1" });
const wa1 = waCalls();
console.log("T1 boas-vindas:",
  sbWrites().some(c => c.method === "POST") &&
  wa1.length === 1 && wa1[0].interactive?.action?.buttons?.[0]?.reply?.title === "Vamos lá!"
  ? "PASS" : "FAIL", JSON.stringify(wa1));

// 2) welcome_sent + "Vamos lá!" → texto portfólio + botões (com wait 3s)
calls.length = 0;
leadRow = { phone: "5511999", current_step: "welcome_sent", last_message_id: "m1" };
const t0 = Date.now();
await processarMensagem({ phone: "5511999", pushName: "Teste", messageText: "Vamos lá!", messageId: "m2" });
const wa2 = waCalls();
console.log("T2 entendimento:",
  wa2.length === 2 && wa2[0].type === "text" && wa2[1].interactive?.action?.buttons?.length === 3 && (Date.now()-t0) >= 2900
  ? "PASS" : "FAIL");

// 3) dedup: mesma messageId não processa
calls.length = 0;
leadRow = { phone: "5511999", current_step: "welcome_sent", last_message_id: "m2" };
await processarMensagem({ phone: "5511999", pushName: "Teste", messageText: "Vamos lá!", messageId: "m2" });
console.log("T3 dedup:", calls.filter(c=>c.url.includes("graph")).length === 0 ? "PASS" : "FAIL");

// 4) entendimento + "Procuro locação" → texto + CRM
calls.length = 0;
leadRow = { phone: "5511999", current_step: "entendimento", last_message_id: "m2" };
await processarMensagem({ phone: "5511999", pushName: "Teste", messageText: "Procuro locação", messageId: "m3" });
console.log("T4 locação+CRM:",
  waCalls().length === 1 && calls.some(c => c.url.includes("roichatpartner")) ? "PASS" : "FAIL");

// 5) entendimento + "Comprar máquina" → lista de faixas
calls.length = 0;
leadRow = { phone: "5511999", current_step: "entendimento", last_message_id: "m2" };
await processarMensagem({ phone: "5511999", pushName: "Teste", messageText: "Comprar máquina", messageId: "m4" });
const wa5 = waCalls();
console.log("T5 faixas:", wa5[0]?.interactive?.type === "list" && wa5[0].interactive.action.sections[0].rows.length === 4 ? "PASS" : "FAIL");

// 6) faixa "R$ 60 mil a R$ 119 mil" → botões objetivo
calls.length = 0;
leadRow = { phone: "5511999", current_step: "faixa", last_message_id: "m4" };
await processarMensagem({ phone: "5511999", pushName: "Teste", messageText: "R$ 60 mil a R$ 119 mil", messageId: "m5" });
const wa6 = waCalls();
console.log("T6 objetivo:", wa6[0]?.interactive?.action?.buttons?.length === 3 ? "PASS" : "FAIL");

// 7) objetivo "Renda extra" com faixa alta → CTA APN (Manhã/Tarde/Noite)
calls.length = 0;
leadRow = { phone: "5511999", current_step: "objetivo", faixa_investimento: "60k_120k", last_message_id: "m5" };
await processarMensagem({ phone: "5511999", pushName: "Teste", messageText: "Renda extra", messageId: "m6" });
const wa7 = waCalls();
console.log("T7 CTA APN:", wa7[0]?.interactive?.header?.text === "Agendamento APN" ? "PASS" : "FAIL");

// 8) objetivo "Renda extra" com faixa baixa → baixo potencial + CRM
calls.length = 0;
leadRow = { phone: "5511999", current_step: "objetivo", faixa_investimento: "ate_12k", last_message_id: "m5" };
await processarMensagem({ phone: "5511999", pushName: "Teste", messageText: "Renda extra", messageId: "m7" });
console.log("T8 baixo potencial:",
  waCalls()[0]?.type === "text" && calls.some(c => c.url.includes("roichatpartner")) ? "PASS" : "FAIL");

// 9) objetivo inválido → re-pergunta SEM CRM (correção do bug)
calls.length = 0;
leadRow = { phone: "5511999", current_step: "objetivo", faixa_investimento: "ate_12k", last_message_id: "m5" };
await processarMensagem({ phone: "5511999", pushName: "Teste", messageText: "blablabla", messageId: "m8" });
console.log("T9 objetivo inválido sem CRM:",
  !calls.some(c => c.url.includes("roichatpartner")) && waCalls()[0]?.interactive?.action?.buttons?.length === 3 ? "PASS" : "FAIL");
