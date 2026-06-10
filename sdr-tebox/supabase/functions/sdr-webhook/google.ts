// Google Calendar + Gmail via REST, autenticando com OAuth refresh token.
// Substitui as tools do agente de agendamento no n8n: "Eventos", "Verifica",
// "Marcar", "Cancelar1" e "Gmail".
//
// As credenciais OAuth do n8n não são exportáveis — gere um refresh token novo
// (instruções no README) e configure GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET /
// GOOGLE_REFRESH_TOKEN como secrets da função.

const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const REFRESH_TOKEN = Deno.env.get("GOOGLE_REFRESH_TOKEN")!;
const CALENDAR_ID = Deno.env.get("GOOGLE_CALENDAR_ID") ?? "primary";

let cachedToken: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.exp - 60_000) return cachedToken.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Falha ao renovar token Google: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedToken = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

async function gFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

const CAL_BASE = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}`;

export async function listarEventos(timeMin: string, timeMax: string): Promise<unknown[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });
  const res = await gFetch(`${CAL_BASE}/events?${params}`);
  if (!res.ok) throw new Error(`Calendar list falhou: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return (data.items ?? []).map((e: Record<string, unknown>) => ({
    id: e.id,
    summary: e.summary,
    start: e.start,
    end: e.end,
  }));
}

export async function criarEvento(args: {
  summary: string;
  description: string;
  start: string;
  end: string;
  attendeeEmail?: string;
}): Promise<{ id: string; meetLink: string | null; htmlLink: string | null }> {
  const body: Record<string, unknown> = {
    summary: args.summary,
    description: args.description,
    start: { dateTime: args.start, timeZone: "America/Sao_Paulo" },
    end: { dateTime: args.end, timeZone: "America/Sao_Paulo" },
    conferenceData: {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };
  if (args.attendeeEmail) body.attendees = [{ email: args.attendeeEmail }];
  const res = await gFetch(`${CAL_BASE}/events?conferenceDataVersion=1&sendUpdates=all`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Calendar create falhou: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const meetLink = data.conferenceData?.entryPoints?.find(
    (p: Record<string, unknown>) => p.entryPointType === "video",
  )?.uri ?? data.hangoutLink ?? null;
  return { id: data.id, meetLink, htmlLink: data.htmlLink ?? null };
}

export async function cancelarEvento(eventId: string): Promise<void> {
  const res = await gFetch(`${CAL_BASE}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 410) {
    throw new Error(`Calendar delete falhou: ${res.status} ${await res.text()}`);
  }
}

function base64url(input: string): string {
  return btoa(unescape(encodeURIComponent(input)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function enviarEmail(args: {
  to: string;
  cc?: string;
  subject: string;
  html: string;
}): Promise<void> {
  const mime = [
    `To: ${args.to}`,
    args.cc ? `Cc: ${args.cc}` : null,
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(args.subject)))}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    args.html,
  ].filter((l) => l !== null).join("\r\n");
  const res = await gFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw: base64url(mime) }),
  });
  if (!res.ok) throw new Error(`Gmail send falhou: ${res.status} ${await res.text()}`);
}
