-- Memória de conversa dos agentes de IA do SDR Tebox.
-- Substitui as tabelas n8n_chat_ia_duvidas e n8n_chat_agendamento que o n8n
-- criava via nós "Postgres Chat Memory". Sessões: {phone}_ia e {phone}_agenda.

create table if not exists public.sdr_chat_memory (
  id bigint generated always as identity primary key,
  session_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists sdr_chat_memory_session_idx
  on public.sdr_chat_memory (session_id, id);

alter table public.sdr_chat_memory enable row level security;
-- Sem policies: somente a service_role (usada pela Edge Function) tem acesso.
