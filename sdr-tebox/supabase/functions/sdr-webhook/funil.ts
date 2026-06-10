// Máquina de estados do funil SDR — réplica dos nós "Determinar Estado1",
// "Switch Etapa1" e de todos os ramos Proc*/Salvar*/Prep*/HTTP Enviar* do fluxo n8n.
//
// Correções em relação ao n8n v11:
// 1. A busca do lead agora FILTRA por telefone (o nó "Buscar Lead Supabase1" fazia
//    getAll sem filtro e usava a primeira linha da tabela).
// 2. Objetivo inválido apenas re-pergunta — no n8n, caía no fallback do
//    "Switch Rotear CTA" e disparava o CRM de baixo potencial indevidamente.
// 3. O ramo da IA de dúvidas foi religado (ver duvidas.ts).

import { createLead, getLead, type Lead, updateLead } from "./db.ts";
import { sendButtons, sendList, sendText } from "./wa.ts";
import { enviarCRM } from "./crm.ts";
import { rodarIADuvidas } from "./duvidas.ts";
import { rodarAgendador } from "./agendador.ts";

export interface Estado {
  phone: string;
  pushName: string;
  messageText: string;
  messageId: string;
  isNew: boolean;
  currentStep: string;
  leadData: Partial<Lead>;
  historicoTexto: string;
  horario?: string;
}

export interface ParsedMessage {
  phone: string;
  pushName: string;
  messageText: string;
  messageId: string;
}

const GREETINGS = [
  "oi", "olá", "ola", "bom dia", "boa tarde", "boa noite", "eae", "opa",
  "hey", "hello", "oie", "fala", "salve", "boa",
];

const BOTOES_ENTENDIMENTO = [
  { id: "1", title: "Comprar máquina" },
  { id: "2", title: "Procuro locação" },
  { id: "3", title: "Quero entender" },
];

const LISTA_FAIXAS = [
  { id: "1", title: "Até R$ 12 mil" },
  { id: "2", title: "R$ 13 mil a R$ 59 mil" },
  { id: "3", title: "R$ 60 mil a R$ 119 mil" },
  { id: "4", title: "Acima de R$ 120 mil" },
];

const BOTOES_OBJETIVO = [
  { id: "1", title: "Renda extra" },
  { id: "2", title: "Primeiro negócio" },
  { id: "3", title: "Expandir negócio" },
];

// ---------- Réplica do "Determinar Estado1" ----------

function montarHistorico(lead: Lead | null, currentStep: string): string {
  if (!lead) return "Lead novo - sem histórico anterior.";

  const stepLabels: Record<string, string> = {
    new: "Novo lead (nunca interagiu)",
    welcome_sent: "Recebeu boas-vindas, não escolheu interesse ainda",
    entendimento: "Escolheu interesse em comprar máquina",
    faixa: "Informou faixa de investimento",
    objetivo: "Informou objetivo",
    cta_apn: "Recebeu convite para APN (Apresentação de Negócio Personalizada)",
    cta_catalogo: "Recebeu opção de falar com especialista/catálogo",
    agendamento: "Em processo de agendamento de APN",
    aguardando_crm: "Aguardando contato de consultor",
    finalizado: "Conversa finalizada anteriormente",
    agendado: "Reunião APN agendada com sucesso",
  };
  const linhas = ["=== HISTÓRICO DESTE LEAD ==="];
  linhas.push("Etapa atual: " + (stepLabels[currentStep] || currentStep));

  if (lead.tipo_interesse) {
    const interesses: Record<string, string> = {
      comprar: "Comprar máquina",
      locacao: "Locar espaço",
      entender: "Entender o negócio",
    };
    linhas.push("Interesse declarado: " + (interesses[lead.tipo_interesse] || lead.tipo_interesse));
  }
  if (lead.faixa_investimento) {
    const faixas: Record<string, string> = {
      ate_12k: "Até R$ 12 mil",
      "12k_60k": "R$ 12k a R$ 60k",
      "60k_120k": "R$ 60k a R$ 120k",
      acima_120k: "Acima de R$ 120k",
    };
    linhas.push("Faixa de investimento: " + (faixas[lead.faixa_investimento] || lead.faixa_investimento));
  }
  if (lead.objetivo) {
    const objs: Record<string, string> = {
      renda_extra: "Renda extra",
      primeiro_negocio: "Primeiro negócio",
      expandir: "Expandir negócio existente",
      robusto: "Montar operação robusta",
    };
    linhas.push("Objetivo: " + (objs[lead.objetivo] || lead.objetivo));
  }
  if (lead.cta_escolha) {
    const caminhos: Record<string, string> = {
      agendamento_opcoes: "Recebeu opções de data para APN",
      agendamento_confirmacao: "Confirmando horário escolhido",
      agendamento_email: "Aguardando e-mail para convite",
      agendamento_concluido: "APN já agendada com sucesso",
      finalizado: "Desistiu do agendamento",
    };
    linhas.push("Status do agendamento: " + (caminhos[lead.cta_escolha] || lead.cta_escolha));
  }
  if (lead.created_at) {
    try {
      linhas.push("Primeiro contato: " + new Date(lead.created_at).toLocaleDateString("pt-BR"));
    } catch { /* ignora */ }
  }
  linhas.push("=== FIM DO HISTÓRICO ===");
  return linhas.join("\n");
}

export async function determinarEstado(msg: ParsedMessage): Promise<Estado | null> {
  const lead = await getLead(msg.phone);

  // Dedup: mensagem já processada
  if (lead?.last_message_id && msg.messageId && lead.last_message_id === msg.messageId) {
    return null;
  }

  const isNew = !lead;
  const currentStep = lead?.current_step || "new";
  const leadData = lead || {};
  const historicoTexto = montarHistorico(lead, currentStep);

  // Pós-funil → IA geral
  const postFunnelCTA = [
    "agendamento_concluido",
    "agendamento_email",
    "agendamento_confirmacao",
    "finalizado",
  ];
  const isPosFunil = !isNew && postFunnelCTA.includes(leadData.cta_escolha || "");

  const msgLow = msg.messageText.toLowerCase().trim();
  const isGreetingDE = GREETINGS.some((g) =>
    msgLow === g || msgLow.startsWith(g + " ") || msgLow.startsWith(g + "!") ||
    msgLow.startsWith(g + ",")
  );
  const agendamentoStuck = !isNew && currentStep === "agendamento" && isGreetingDE;

  if (isPosFunil || agendamentoStuck) {
    return { ...msg, isNew, currentStep: "ia_atendimento", leadData, historicoTexto };
  }

  // "Quero entender" fora das etapas iniciais → IA geral
  const querEntender = msgLow.includes("quero entender") || msgLow === "entender";
  const stepsIniciais = ["new", "welcome_sent", "entendimento"];
  if (querEntender && !stepsIniciais.includes(currentStep)) {
    return { ...msg, isNew, currentStep: "ia_route", leadData, historicoTexto };
  }

  return { ...msg, isNew, currentStep, leadData, historicoTexto };
}

// ---------- Ramos do funil ----------

async function ramoBoasVindas(e: Estado): Promise<void> {
  const sendTextBV =
    "Olá, somos a Tebox Diversões 🎯\nEstamos há mais de 10 anos no mercado e somos referência em máquinas de autoatendimento para investimento.\n\nTrabalhamos com máquinas que geram renda recorrente em:\n• Shoppings\n• Mercados\n• Galerias\n• Parques indoor\n\nGostaria de iniciar o atendimento?";

  if (e.isNew) {
    await createLead({
      phone: e.phone,
      push_name: e.pushName,
      current_step: "welcome_sent",
      last_message_id: e.messageId,
    });
  } else {
    await updateLead(e.phone, {
      push_name: e.pushName,
      current_step: "welcome_sent",
      last_message_id: e.messageId,
    });
  }
  await sendButtons(e.phone, sendTextBV, [{ id: "1", title: "Vamos lá!" }], "Toy Box Diversões");
}

async function ramoEntendimento(e: Estado): Promise<void> {
  const msg = e.messageText.trim().toLowerCase();
  if (msg === "1" || msg.includes("vamos")) {
    await updateLead(e.phone, { current_step: "entendimento", last_message_id: e.messageId });
    const txt1 =
      "Em nosso portfólio contamos com:\n\n• Máquinas de Snacks e Caixas misteriosas\n• Gruas (Máquinas de pelúcias e brindes)\n• Impressão de Capinhas Personalizadas\n• Simuladores Indoor\n\nAntes de te apresentar as oportunidades, preciso confirmar 3 informações rápidas 👇";
    await sendText(e.phone, txt1);
    await new Promise((r) => setTimeout(r, 3000)); // réplica do nó "Wait 3s"
    await sendButtons(
      e.phone,
      "Nosso modelo é a VENDA da máquina (investimento próprio), não locação.\n\nVocê está buscando:",
      BOTOES_ENTENDIMENTO,
      "Modelo de negócio",
    );
    return;
  }
  await updateLead(e.phone, { current_step: "welcome_sent", last_message_id: e.messageId });
  await sendButtons(
    e.phone,
    'Por favor, clique no botão "Vamos lá!" para iniciar o atendimento.',
    [{ id: "1", title: "Vamos lá!" }],
  );
}

async function ramoFaixa(e: Estado): Promise<void> {
  const msg = e.messageText.trim().toLowerCase();
  const isCompra = msg === "1" || msg.includes("comprar");
  const isLoca = msg === "2" || msg.includes("locacao") || msg.includes("locação");
  const isEntend = msg === "3" || msg.includes("entender");

  if (isLoca) {
    await updateLead(e.phone, {
      current_step: "aguardando_crm",
      tipo_interesse: "locacao",
      last_message_id: e.messageId,
    });
    await sendText(
      e.phone,
      "Você está buscando:\n(X) Estou procurando locação\n\nEm nossa linha de locação dividimos os ganhos do equipamento contigo pelo seu ponto.\n\nEm breve um de nossos consultores vai entrar em contato com você para apresentar as condições de locação. Obrigado!",
    );
    await enviarCRM({ nome: e.pushName, telefone: e.phone, interesse: "Locação de Máquinas" });
    return;
  }
  if (isEntend) {
    await updateLead(e.phone, {
      current_step: "aguardando_crm",
      tipo_interesse: "entender",
      last_message_id: e.messageId,
    });
    await sendText(
      e.phone,
      "Ótimo! Vou te explicar tudo sobre o nosso modelo de negócio. Me conte: o que você gostaria de saber primeiro?",
    );
    return; // próxima mensagem cai no fallback → IA de dúvidas
  }
  if (isCompra) {
    await updateLead(e.phone, {
      current_step: "faixa",
      tipo_interesse: "comprar",
      last_message_id: e.messageId,
    });
    await sendList(e.phone, "Qual faixa você pretende investir hoje?", "Escolher faixa", "Opções", LISTA_FAIXAS);
    return;
  }
  await updateLead(e.phone, { current_step: "entendimento", last_message_id: e.messageId });
  await sendButtons(
    e.phone,
    'Não entendi. Por favor, escolha a opção "Comprar", "Locação" ou "Entender" clicando nos botões.',
    BOTOES_ENTENDIMENTO,
  );
}

async function ramoObjetivo(e: Estado): Promise<void> {
  const msg = e.messageText.trim().toLowerCase();

  let faixa: string | null = null;
  if (msg === "1" || msg.includes("ate") || msg.includes("até") || msg.includes("12")) faixa = "ate_12k";
  else if (msg === "2" || msg.includes("13") || msg.includes("59")) faixa = "12k_60k";
  else if (msg === "3" || msg.includes("60") || msg.includes("119")) faixa = "60k_120k";
  else if (msg === "4" || msg.includes("acima") || msg.includes("120")) faixa = "acima_120k";

  if (!faixa) {
    await updateLead(e.phone, { current_step: "faixa", last_message_id: e.messageId });
    await sendList(
      e.phone,
      "Não entendi. Por favor, clique na lista e escolha uma das faixas sugeridas.",
      "Escolher faixa",
      "Opções",
      LISTA_FAIXAS,
    );
    return;
  }
  await updateLead(e.phone, {
    current_step: "objetivo",
    faixa_investimento: faixa,
    last_message_id: e.messageId,
  });
  await sendButtons(e.phone, "Qual seu objetivo principal?", BOTOES_OBJETIVO, "Seu objetivo");
}

async function ramoRotearCTA(e: Estado): Promise<void> {
  const msg = e.messageText.trim().toLowerCase();
  const fx = e.leadData.faixa_investimento || "";

  let objetivo: string | null = null;
  if (msg === "1" || msg.includes("renda")) objetivo = "renda_extra";
  else if (msg === "2" || msg.includes("primeiro")) objetivo = "primeiro_negocio";
  else if (msg === "3" || msg.includes("expandir")) objetivo = "expandir";

  if (!objetivo) {
    await updateLead(e.phone, { current_step: "objetivo", last_message_id: e.messageId });
    await sendButtons(
      e.phone,
      "Não entendi. Por favor, escolha e clique numa das opções de objetivo.",
      BOTOES_OBJETIVO,
    );
    return;
  }

  const isAPN = ["60k_120k", "acima_120k"].includes(fx) || objetivo === "expandir";

  if (isAPN) {
    await updateLead(e.phone, {
      current_step: "cta_apn",
      objetivo,
      last_message_id: e.messageId,
    });
    await sendButtons(
      e.phone,
      "Excelente perfil 👏\nPelo seu nível de investimento, o ideal é participar de uma APN – Apresentação de Negócio, onde mostramos:\n• Margens reais\n• Estrutura operacional\n• Payback\n• Escala do negócio\n\nA apresentação dura cerca de 25 minutos.\n\nQual melhor horário para agendar?",
      [
        { id: "1", title: "Manhã" },
        { id: "2", title: "Tarde" },
        { id: "3", title: "Noite" },
      ],
      "Agendamento APN",
    );
    return;
  }

  await updateLead(e.phone, {
    current_step: "aguardando_crm",
    objetivo,
    last_message_id: e.messageId,
  });
  await sendText(
    e.phone,
    "Perfeito 👌\nVou te direcionar para um de nossos especialistas que vai te ajudar a encontrar a melhor opção para o seu perfil de investimento.\n\nEm breve um consultor entrará em contato pelo WhatsApp!",
  );
  await enviarCRM({
    nome: e.pushName,
    telefone: e.phone,
    interesse: "Compra - Baixo Potencial",
    faixa: fx,
    objetivo,
  });
}

async function ramoCtaApn(e: Estado): Promise<void> {
  const msg = e.messageText.trim().toLowerCase();

  let horario: string | null = null;
  if (msg === "1" || msg.includes("manha") || msg.includes("manhã") || msg.includes("cedo")) horario = "manha";
  else if (msg === "2" || msg.includes("tarde")) horario = "tarde";
  else if (msg === "3" || msg.includes("noite")) horario = "noite";

  if (horario) {
    // Avança direto para o agente de agendamento (PASSO 1)
    await updateLead(e.phone, { last_message_id: e.messageId, horario_preferido: horario });
    await rodarAgendador({ ...e, horario, leadData: { ...e.leadData, cta_escolha: null } });
    return;
  }

  await updateLead(e.phone, { current_step: "cta_apn", last_message_id: e.messageId });
  await sendText(e.phone, "Por favor, escolha um dos horários informados.");
}

async function ramoCtaCatalogo(e: Estado): Promise<void> {
  const msg = e.messageText.trim().toLowerCase();

  let horario: string | null = null;
  if (msg === "1" || msg.includes("manha") || msg.includes("manhã") || msg.includes("cedo")) horario = "manha";
  else if (msg === "2" || msg.includes("tarde")) horario = "tarde";
  else if (msg === "3" || msg.includes("noite")) horario = "noite";
  else if (msg === "4" || msg.includes("agora") || msg.includes("chamar")) horario = "agora";

  if (horario) {
    await updateLead(e.phone, { current_step: "aguardando_crm", last_message_id: e.messageId });
    await sendText(
      e.phone,
      "Perfeito! Em breve um de nossos consultores vai entrar em contato com você para apresentar o catálogo completo. Obrigado!",
    );
    await enviarCRM({ nome: e.pushName, telefone: e.phone, interesse: "Catalogo - Especialista" });
    return;
  }
  await updateLead(e.phone, { current_step: "cta_catalogo", last_message_id: e.messageId });
  await sendText(e.phone, "Por favor, clique na lista e escolha um dos horários exibidos.");
}

async function ramoAgendamento(e: Estado): Promise<void> {
  await updateLead(e.phone, { last_message_id: e.messageId });
  const ok = await rodarAgendador(e);
  if (!ok) {
    // Sessão expirada (réplica do "Sessão Expirada?" saída true) → IA geral
    await rodarIADuvidas(e);
  }
}

// ---------- Réplica do "Switch Etapa1" ----------

export async function processarMensagem(msg: ParsedMessage): Promise<void> {
  const estado = await determinarEstado(msg);
  if (!estado) return; // duplicada

  switch (estado.currentStep) {
    case "new":
      return ramoBoasVindas(estado);
    case "welcome_sent":
      return ramoEntendimento(estado);
    case "entendimento":
      return ramoFaixa(estado);
    case "faixa":
      return ramoObjetivo(estado);
    case "objetivo":
      return ramoRotearCTA(estado);
    case "cta_apn":
      return ramoCtaApn(estado);
    case "cta_catalogo":
      return ramoCtaCatalogo(estado);
    case "agendamento":
      return ramoAgendamento(estado);
    default: {
      // Fallback (aguardando_crm, ia_atendimento, ia_route, finalizado, etc.) → IA de dúvidas
      await updateLead(estado.phone, { last_message_id: estado.messageId });
      return rodarIADuvidas(estado);
    }
  }
}
