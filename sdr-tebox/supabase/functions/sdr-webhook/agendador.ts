// Agente de agendamento de APN — réplica dos nós "Prep Agendador", "Sessão Expirada?",
// "Enviar Aguarde", "IA - Responde Dúvidas1" (com tools Eventos/Verifica/Marcar/
// Cancelar1/Gmail/Think), "Pos Agendador", "Salvar Caminho Agendamento" e
// "Prep/HTTP Enviar Resposta IA" do fluxo n8n.

import { memAppend, memGet, updateLead } from "./db.ts";
import { runAgent, type ToolDef } from "./openai.ts";
import { sendButtons, sendText, type Button } from "./wa.ts";
import { cancelarEvento, criarEvento, enviarEmail, listarEventos } from "./google.ts";
import type { Estado } from "./funil.ts";

const COPIA_EMAIL = Deno.env.get("CRM_COPY_EMAIL") ?? "alexandre@toyboxdiversoes.com";

type SubEtapa =
  | "APRESENTAR_OPCOES"
  | "AGUARDANDO_ESCOLHA"
  | "CONFIRMAR_HORARIO"
  | "AGUARDANDO_EMAIL"
  | "CANCELAR";

const GREETINGS = [
  "oi", "olá", "ola", "bom dia", "boa tarde", "boa noite", "eae", "opa",
  "hey", "hello", "oie", "e aí", "e ai", "fala", "salve",
];

function isGreeting(msg: string): boolean {
  const m = msg.toLowerCase().trim();
  return GREETINGS.some((g) =>
    m === g || m.startsWith(g + " ") || m.startsWith(g + "!") || m.startsWith(g + ",")
  );
}

// Réplica do "Prep Agendador": decide a sub-etapa e o texto [PASSO n] para a IA.
// Retorna null quando a sessão expirou (saudação + >2h parado) → volta pra IA geral.
export function prepAgendador(estado: Estado): {
  subEtapa: SubEtapa;
  textParaIA: string;
  horario: string;
} | null {
  const { messageText, leadData } = estado;
  const msgLower = messageText.toLowerCase().trim();
  const agendamentoState = leadData.cta_escolha || "";
  const horario = leadData.horario_preferido || estado.horario || "qualquer";

  const lastUpdate = leadData.updated_at ? new Date(leadData.updated_at) : null;
  const hoursSinceLastMsg = lastUpdate
    ? (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60)
    : 0;
  if (isGreeting(messageText) && hoursSinceLastMsg > 2) return null; // sessão expirada

  let subEtapa: SubEtapa;
  if (agendamentoState === "agendamento_confirmacao") {
    if (msgLower.includes("confirmar") || msgLower === "1") subEtapa = "AGUARDANDO_EMAIL";
    else if (msgLower.includes("outra") || msgLower.includes("escolher") || msgLower === "2") {
      subEtapa = "APRESENTAR_OPCOES";
    } else if (
      msgLower.includes("não") || msgLower.includes("cancelar") ||
      msgLower.includes("seguir") || msgLower === "3"
    ) subEtapa = "CANCELAR";
    else subEtapa = "CONFIRMAR_HORARIO";
  } else if (agendamentoState === "agendamento_email") subEtapa = "AGUARDANDO_EMAIL";
  else if (agendamentoState === "agendamento_opcoes") subEtapa = "AGUARDANDO_ESCOLHA";
  else subEtapa = "APRESENTAR_OPCOES";

  let textParaIA: string;
  if (subEtapa === "APRESENTAR_OPCOES") {
    const nowBrasilia = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    textParaIA = "[PASSO 1] MOMENTO ATUAL: " + nowBrasilia +
      " (horario de Brasilia). Apresente exatamente 3 opcoes de data e horario disponiveis APENAS NO FUTURO (posteriores ao momento atual). Use a ferramenta eventos_listar para verificar a agenda. Descarte qualquer horario que ja passou. PRIORIZE DATAS NO PERIODO: " +
      horario.toUpperCase() + ". Mensagem do lead: " + estado.messageText;
  } else if (subEtapa === "AGUARDANDO_ESCOLHA") {
    textParaIA =
      "[PASSO 2] O lead escolheu uma opcao. Identifique qual opcao ele escolheu e gere a mensagem de confirmacao. Mensagem: " +
      estado.messageText;
  } else if (subEtapa === "CONFIRMAR_HORARIO") {
    textParaIA =
      "[PASSO CONFIRMAR] O lead recebeu a confirmacao mas nao clicou nos botoes. Pergunte se deseja confirmar o horario escolhido. Mensagem: " +
      estado.messageText;
  } else if (subEtapa === "AGUARDANDO_EMAIL") {
    textParaIA =
      "[PASSO 3] O lead CONFIRMOU o horario! Agora peca APENAS o e-mail. Mensagem: " +
      estado.messageText;
  } else {
    textParaIA = "[PASSO CANCELAR] O lead nao quer seguir. Agradeca e diga que estamos a disposicao.";
  }

  return { subEtapa, textParaIA, horario };
}

function systemPrompt(horario: string): string {
  return `Voce e assistente de agendamento da Toy Box Diversoes. Agende uma APN de 25 minutos.

Siga o PASSO indicado no campo texto da mensagem.

HORÁRIOS DISPONÍVEIS DO ESPECIALISTA (GILSON) - RESPEITE RIGOROSAMENTE:
Segunda-feira: 13h às 19h
Terça-feira: 13h às 19h
Quarta-feira: 13h às 19h
Quinta-feira: 7h às 12h e 14h às 17h
Sexta-feira: 7h às 12h e 14h às 19h
Sábado: 9h às 17h
Domingo: INDISPONÍVEL

DEFINIÇÃO DOS TURNOS DO CLIENTE:
- MANHÃ = 7h às 12h → Dias possíveis: Quinta (7h-12h), Sexta (7h-12h), Sábado (9h-12h)
- TARDE = 13h às 18h → Dias possíveis: Segunda a Quarta (13h-18h), Quinta (14h-17h), Sexta (14h-18h), Sábado (13h-17h)
- NOITE = 18h às 19h → MUITO LIMITADO. Dias possíveis: Segunda a Quarta (18h-19h), Sexta (18h-19h). AVISE o cliente que a disponibilidade noturna é restrita.

REGRA CRÍTICA: Se o turno preferido do cliente NAO tiver disponibilidade suficiente, apresente os horários mais próximos disponíveis e avise: "Infelizmente não temos muita disponibilidade no período [turno]. Seguem as opções mais próximas:"

PASSO 1 — APRESENTAR OPCOES
- Use eventos_listar para verificar horarios OCUPADOS nos proximos 7 dias
- Calcule os dias da semana CORRETAMENTE a partir da data atual
- Sugira APENAS horarios DENTRO da grade acima para cada dia da semana
- NUNCA sugira horarios fora do expediente do especialista
- VARIE os horarios (nunca todos iguais)
- Formato OBRIGATORIO (CURTO, max 18 chars por linha):
  "Ola [Nome]! Aqui estao 3 opcoes disponiveis:
   1 - Seg 02/03 14:00
   2 - Ter 03/03 10:30
   3 - Sab 08/03 09:00
   Qual prefere?"
- ABREVIE os dias: Seg, Ter, Qua, Qui, Sex, Sab
- NUNCA escreva por extenso (segunda, terça, etc)
- Horário SEMPRE com 2 dígitos: 09:00, 14:30

PASSO 2 — AGUARDANDO ESCOLHA
- O usuario acabou de escolher uma das 3 opcoes apresentadas
- Aceite "1", "2", "3", "segunda", "primeira", "a terceira", "opcao 2", etc.
- Identifique qual data/horario ele escolheu
- Responda com mensagem de CONFIRMACAO:
  "Perfeito, só para alinharmos antes de confirmar na agenda 👇

   Você selecionou:
   📅 [Data completa] às [HH:mm]

   Essa reunião será uma APN – Apresentação de Negócio com um especialista da Toy Box Diversões para entender seu cenário e apresentar as oportunidades.

   Como prefere seguir agora?"
- NAO peca email ainda. NAO use evento_criar. NAO apresente novas opcoes.

PASSO CONFIRMAR — CONFIRMACAO DO HORARIO
- O lead ainda nao confirmou. Pergunte novamente se quer confirmar, escolher outra data ou cancelar.

PASSO CANCELAR — LEAD NAO QUER SEGUIR
- Responda: "Sem problemas! Caso mude de ideia, estamos à disposição. Até mais! 👋"
- NAO insista. NAO ofereça novas datas.

PASSO 3 — AGUARDANDO EMAIL
- Email do usuario: leia da mensagem recebida
- Se invalido (sem @ ou sem .): "Nao reconheci esse e-mail. Pode confirmar?"
- Se valido:
  → Use eventos_listar para confirmar disponibilidade do slot escolhido
  → Use evento_criar para criar evento de 25min. Summary: "APN - Toy Box Diversões". Description: DEVE incluir "WhatsApp: [numero do lead]" e "Nome: [nome do lead]". Passe o e-mail do lead como attendeeEmail.
  → Use enviar_email para enviar email de confirmacao ao lead informando data, horario e que o link de acesso estara no convite do Google Calendar
  → Envie uma cópia (cc) para o e-mail: ${COPIA_EMAIL}
  → SEMPRE inclua o link do meeting na mensagem do WhatsApp.

  → Responda no WhatsApp APENAS:
     "✅ Reunião confirmada!
      📅 Data: [Dia abreviado], [dd/MM] às [HH:mm]
      📧 Segue o link da reunião: [link do Meet]. Enviamos um convite para [email] com o link de acesso.

      Nos vemos lá! 🤝"

REGRAS:
- evento_criar SOMENTE no PASSO 3
- Horarios OBRIGATORIAMENTE dentro da grade do especialista
- VARIE os horarios entre as 3 opcoes (nunca todos no mesmo horario)
- NUNCA classifique 14h, 15h, 16h, 17h como "noite". Isso é TARDE.
- NOITE é SOMENTE a partir das 18h.

CRÍTICO: O HORÁRIO PREFERIDO DO CLIENTE É: ${horario}. PRIORIZE OPÇÕES DENTRO DESSE TURNO!`;
}

function tools(estado: Estado): ToolDef[] {
  return [
    {
      name: "eventos_listar",
      description:
        "Busca os eventos já agendados na agenda do especialista dentro de um período. Use para verificar horários ocupados antes de sugerir ou confirmar opções.",
      parameters: {
        type: "object",
        properties: {
          timeMin: { type: "string", description: "Início do período, ISO 8601 com fuso -03:00" },
          timeMax: { type: "string", description: "Fim do período, ISO 8601 com fuso -03:00" },
        },
        required: ["timeMin", "timeMax"],
      },
      run: async (args) =>
        JSON.stringify(await listarEventos(String(args.timeMin), String(args.timeMax))),
    },
    {
      name: "evento_criar",
      description:
        "Cria o evento da APN (25 minutos) na agenda, com link do Google Meet. Use SOMENTE no PASSO 3, após receber o e-mail válido do lead.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: 'Nome do evento, ex: "APN - Toy Box Diversões"' },
          description: {
            type: "string",
            description: "Descrição. DEVE incluir WhatsApp e Nome do lead.",
          },
          start: { type: "string", description: "Início, ISO 8601 com fuso -03:00" },
          end: { type: "string", description: "Fim (início + 25min), ISO 8601 com fuso -03:00" },
          attendeeEmail: { type: "string", description: "E-mail do lead (convidado)" },
        },
        required: ["summary", "description", "start", "end"],
      },
      run: async (args) =>
        JSON.stringify(
          await criarEvento({
            summary: String(args.summary),
            description: String(args.description),
            start: String(args.start),
            end: String(args.end),
            attendeeEmail: args.attendeeEmail ? String(args.attendeeEmail) : undefined,
          }),
        ),
    },
    {
      name: "evento_cancelar",
      description:
        "Cancela/desmarca um evento da agenda. Primeiro use eventos_listar para obter o id do evento que coincide com o pedido do usuário.",
      parameters: {
        type: "object",
        properties: {
          eventId: { type: "string", description: "Id do evento a cancelar" },
        },
        required: ["eventId"],
      },
      run: async (args) => {
        await cancelarEvento(String(args.eventId));
        return "Evento cancelado com sucesso.";
      },
    },
    {
      name: "enviar_email",
      description:
        "Envia o e-mail de confirmação da reunião para o lead (HTML), com cópia para a equipe.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "E-mail do lead" },
          subject: { type: "string", description: "Assunto do e-mail" },
          html: {
            type: "string",
            description:
              "Corpo HTML do e-mail com data, horário, assunto e aviso de que o link está no convite do Google Calendar. Assine como Gilson Arruda.",
          },
        },
        required: ["to", "subject", "html"],
      },
      run: async (args) => {
        await enviarEmail({
          to: String(args.to),
          cc: COPIA_EMAIL,
          subject: String(args.subject),
          html: String(args.html),
        });
        return "E-mail enviado.";
      },
    },
    {
      name: "think",
      description:
        "Use para raciocinar passo a passo (cálculo de dias da semana, conferência da grade de horários) antes de responder. Não tem efeito externo.",
      parameters: {
        type: "object",
        properties: { thought: { type: "string" } },
        required: ["thought"],
      },
      run: (args) => Promise.resolve(String(args.thought ?? "ok")),
    },
  ];
}

// Réplica do "Pos Agendador": converte as 3 opções em botões e calcula o novo caminho.
function posAgendador(subEtapa: SubEtapa, outputText: string): {
  novoCaminho: string;
  bodyText: string;
  buttons: Button[];
  isInteractive: boolean;
} {
  let novoCaminho: string;
  if (subEtapa === "APRESENTAR_OPCOES") novoCaminho = "agendamento_opcoes";
  else if (subEtapa === "AGUARDANDO_ESCOLHA") novoCaminho = "agendamento_confirmacao";
  else if (subEtapa === "CONFIRMAR_HORARIO") novoCaminho = "agendamento_confirmacao";
  else if (subEtapa === "AGUARDANDO_EMAIL") novoCaminho = "agendamento_email";
  else if (subEtapa === "CANCELAR") novoCaminho = "finalizado";
  else novoCaminho = "agendamento_concluido";

  let isInteractive = false;
  let buttons: Button[] = [];
  let bodyText = outputText;

  if (subEtapa === "APRESENTAR_OPCOES") {
    const lines = outputText.split("\n");
    const optionRegex = /^\s*(\d)\s*[-–.]\s*(.+)/;
    const headerLines: string[] = [];
    const optionLines: { id: string; label: string }[] = [];
    const footerLines: string[] = [];

    for (const line of lines) {
      const match = line.match(optionRegex);
      if (match && optionLines.length < 3) {
        optionLines.push({ id: match[1], label: match[2].trim() });
      } else if (optionLines.length === 0) headerLines.push(line);
      else footerLines.push(line);
    }

    if (optionLines.length === 3) {
      isInteractive = true;
      bodyText = headerLines.join("\n").trim();
      if (footerLines.length > 0) bodyText += "\n" + footerLines.join("\n").trim();
      buttons = optionLines.map((opt) => {
        let title = opt.label.trim().replace(" às ", " ").replace(" as ", " ");
        if (title.length > 20) title = title.substring(0, 20);
        return { id: opt.id, title };
      });
    }
  }

  if (subEtapa === "AGUARDANDO_ESCOLHA") {
    isInteractive = true;
    bodyText = outputText;
    buttons = [
      { id: "confirmar", title: "Confirmar horário" },
      { id: "outra", title: "Escolher outra data" },
      { id: "nao", title: "Não quero seguir" },
    ];
  }

  return { novoCaminho, bodyText, buttons, isInteractive };
}

// Quando AGUARDANDO_EMAIL termina e o e-mail era válido (evento criado),
// o caminho final é "agendamento_concluido"; o texto da IA indica isso.
function caminhoFinal(subEtapa: SubEtapa, novoCaminho: string, output: string): string {
  if (subEtapa === "AGUARDANDO_EMAIL" && /reuni[aã]o confirmada/i.test(output)) {
    return "agendamento_concluido";
  }
  return novoCaminho;
}

export async function rodarAgendador(estado: Estado): Promise<boolean> {
  const prep = prepAgendador(estado);
  if (!prep) return false; // sessão expirada → quem chamou roteia para a IA geral

  const { phone, pushName } = estado;
  const { subEtapa, textParaIA, horario } = prep;

  // Réplica do "Enviar Aguarde"
  const aguarde = subEtapa === "APRESENTAR_OPCOES"
    ? "⏳ Só um instante, " + (pushName || "") + "! Estou verificando os melhores horários disponíveis na agenda..."
    : subEtapa === "AGUARDANDO_ESCOLHA"
    ? "✅ Ótima escolha! Já estou preparando tudo..."
    : "✉️ Perfeito! Estou criando o evento e já te envio a confirmação...";
  if (subEtapa !== "CANCELAR" && subEtapa !== "CONFIRMAR_HORARIO") {
    await sendText(phone, aguarde);
  }

  const sessionId = `${phone}_agenda`;
  const history = await memGet(sessionId, 40);
  let output = await runAgent(systemPrompt(horario), history, textParaIA, tools(estado));
  if (!output || output.trim() === "" || output === "{}") {
    output = "Um instante, estou verificando a disponibilidade...";
  }

  await memAppend(sessionId, "user", textParaIA);
  await memAppend(sessionId, "assistant", output);

  const pos = posAgendador(subEtapa, output);
  const novoCaminho = caminhoFinal(subEtapa, pos.novoCaminho, output);

  // Réplica do "Salvar Caminho Agendamento"
  const step = (novoCaminho === "agendamento_concluido" || novoCaminho === "finalizado")
    ? "aguardando_crm"
    : "agendamento";
  await updateLead(phone, {
    cta_escolha: novoCaminho,
    current_step: step,
    horario_preferido: horario,
  });

  // Réplica do "Prep/HTTP Enviar Resposta IA"
  if (pos.isInteractive && pos.buttons.length >= 2) {
    const headerText = subEtapa === "AGUARDANDO_ESCOLHA"
      ? "Confirmação de horário"
      : "Horários disponíveis";
    await sendButtons(phone, pos.bodyText || output, pos.buttons, headerText);
  } else {
    await sendText(phone, output);
  }
  return true;
}
