# SDR Digital — Tebox Diversões (sem n8n)

Substituto completo do workflow n8n **"SDR Digital - Tebox Diversoes v11"**
(id `w1WurrA9lz4653KG`), implementado como uma **Supabase Edge Function**
(`sdr-webhook`). Todo o funil de qualificação via WhatsApp, os dois agentes de
IA e as integrações (Supabase, Claude (Anthropic), Google Calendar/Meet, Gmail, CRM ROI
Chat) foram replicados nó a nó.

> Esta pasta é autocontida e **não tem relação com a landing page** deste
> repositório (está fora do build do Next.js — ver `tsconfig.json`).

## O que o fluxo faz

1. **Webhook do WhatsApp** (Meta Cloud API) recebe a mensagem do lead.
2. **Funil de qualificação** com botões/listas interativas:
   boas-vindas → entendimento (comprar/locação/entender) → faixa de
   investimento → objetivo → qualificação:
   - faixa ≥ R$ 60 mil **ou** objetivo "expandir" → convite para **APN**;
   - senão → **baixo potencial** → CRM;
   - locação → CRM.
3. **Agente IA de dúvidas** (Claude) para mensagens livres, com memória de 40
   mensagens e classificação `[ACAO:APN|VENDEDOR|LOCACAO]`.
4. **Agente IA de agendamento** da APN: consulta a agenda (Google Calendar),
   propõe 3 horários dentro da grade do especialista, confirma, coleta e-mail,
   cria o evento com **Google Meet**, envia e-mail de confirmação (**Gmail**,
   com cópia para a equipe) e devolve o link no WhatsApp.
5. **Estado do lead** na tabela `sdr_leads` (Supabase) e memória dos agentes na
   tabela nova `sdr_chat_memory`.

## Correções em relação ao n8n v11

O fluxo original tinha defeitos que foram corrigidos aqui:

1. **Ramo da IA de dúvidas estava morto**: `Pos IA Duvidas` apontava para um nó
   "Switch Acao IA" que havia sido deletado — a resposta da IA nunca chegava ao
   lead. Reimplementado em `duvidas.ts` (incluindo o roteamento das ações).
2. **Busca de lead sem filtro**: `Buscar Lead Supabase1` fazia `getAll` da
   tabela inteira e usava a primeira linha. Agora filtra por `phone`.
3. **Objetivo inválido disparava CRM indevidamente** (caía no fallback do
   `Switch Rotear CTA`). Agora apenas re-pergunta.
4. **Tokens hardcoded** (WhatsApp e anon key do Supabase) viraram secrets.

## Arquivos

| Arquivo | Substitui no n8n |
| --- | --- |
| `supabase/functions/sdr-webhook/index.ts` | WhatsApp Trigger, Parsear Mensagem |
| `supabase/functions/sdr-webhook/funil.ts` | Determinar Estado1, Switch Etapa1 e todos os ramos Proc*/Salvar*/Prep*/HTTP Enviar* |
| `supabase/functions/sdr-webhook/duvidas.ts` | IA - Responde Dúvidas, Pos IA Duvidas (+ Switch Acao IA reconstruído) |
| `supabase/functions/sdr-webhook/agendador.ts` | Prep Agendador, IA - Responde Dúvidas1, Pos Agendador, Salvar Caminho Agendamento, Enviar Aguarde |
| `supabase/functions/sdr-webhook/google.ts` | Tools Eventos, Verifica, Marcar, Cancelar1, Gmail |
| `supabase/functions/sdr-webhook/claude.ts` | OpenAI Chat Model(1) + loop do Agent (agora via API do Claude) |
| `supabase/functions/sdr-webhook/wa.ts` | Nós HTTP de envio WhatsApp |
| `supabase/functions/sdr-webhook/db.ts` | Nós Supabase + Postgres Chat Memory |
| `supabase/functions/sdr-webhook/crm.ts` | Nós de CRM (ROI Chat) |
| `supabase/migrations/20260610_sdr_chat_memory.sql` | Tabelas n8n_chat_* |

## Deploy

Pré-requisito: [Supabase CLI](https://supabase.com/docs/guides/cli) logado no
projeto Toybox (`buukonxxxppwwovbielw`).

```bash
cd sdr-tebox

# 1. Criar a tabela de memória
supabase db push          # ou rode a migration manualmente no SQL Editor

# 2. Configurar secrets
cp .env.example .env      # preencha os valores
supabase secrets set --env-file .env

# 3. Deploy da função (sem verificação de JWT — a Meta chama sem token Supabase)
supabase functions deploy sdr-webhook --no-verify-jwt
```

URL resultante:
`https://buukonxxxppwwovbielw.supabase.co/functions/v1/sdr-webhook`

## Apontar o WhatsApp para a função

No painel da Meta (developers.facebook.com → app do WhatsApp → Configuration →
Webhook):

1. **Callback URL**: a URL da função acima.
2. **Verify token**: o mesmo valor de `META_VERIFY_TOKEN`.
3. Assine o campo **messages**.

A partir daí o n8n deixa de receber qualquer mensagem (o workflow já está
desativado lá; pode ser arquivado).

## Credenciais do Google (Calendar + Gmail)

Os tokens OAuth ficavam dentro do n8n e não são exportáveis. Gere um refresh
token novo para a conta `eunielhenrique@gmail.com`:

1. No [Google Cloud Console](https://console.cloud.google.com), crie/reuse um
   OAuth Client (tipo *Web application*) com escopo para Calendar e Gmail e
   adicione `https://developers.google.com/oauthplayground` como redirect URI.
2. No [OAuth Playground](https://developers.google.com/oauthplayground):
   engrenagem → *Use your own OAuth credentials* → informe Client ID/Secret.
3. Autorize os escopos:
   `https://www.googleapis.com/auth/calendar` e
   `https://www.googleapis.com/auth/gmail.send`.
4. Troque o authorization code por tokens e copie o **refresh token** para o
   `.env` (`GOOGLE_REFRESH_TOKEN`).

## Teste rápido

```bash
# Simula uma mensagem de texto chegando (substitua a URL e o telefone)
curl -X POST 'https://buukonxxxppwwovbielw.supabase.co/functions/v1/sdr-webhook' \
  -H 'Content-Type: application/json' \
  -d '{"entry":[{"changes":[{"value":{"messages":[{"from":"5511999999999","id":"wamid.teste1","type":"text","text":{"body":"oi"}}],"contacts":[{"profile":{"name":"Teste"}}]}}]}]}'
```

Deve criar o lead em `sdr_leads` e enviar a mensagem de boas-vindas com o botão
"Vamos lá!" para o número informado.
