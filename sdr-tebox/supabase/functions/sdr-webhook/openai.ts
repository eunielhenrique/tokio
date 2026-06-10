// Cliente OpenAI (chat completions com suporte a tools).
// Substitui os nós "OpenAI Chat Model"/"OpenAI Chat Model1" e o loop interno
// dos agentes LangChain do n8n.

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<string>;
}

type Msg = Record<string, unknown>;

async function chatCompletion(messages: Msg[], tools?: ToolDef[]): Promise<Msg> {
  const body: Record<string, unknown> = { model: MODEL, messages };
  if (tools?.length) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenAI falhou: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message;
}

// Executa o agente: chama o modelo e resolve tool calls em loop (máx. 8 rodadas),
// como o nó Agent do n8n fazia internamente.
export async function runAgent(
  system: string,
  history: { role: string; content: string }[],
  userText: string,
  tools: ToolDef[] = [],
): Promise<string> {
  const messages: Msg[] = [
    { role: "system", content: system },
    ...history,
    { role: "user", content: userText },
  ];

  for (let i = 0; i < 8; i++) {
    const msg = await chatCompletion(messages, tools);
    const toolCalls = msg.tool_calls as
      | { id: string; function: { name: string; arguments: string } }[]
      | undefined;

    if (!toolCalls?.length) {
      return (msg.content as string) ?? "";
    }

    messages.push(msg);
    for (const call of toolCalls) {
      const tool = tools.find((t) => t.name === call.function.name);
      let result: string;
      try {
        const args = JSON.parse(call.function.arguments || "{}");
        result = tool ? await tool.run(args) : `Tool ${call.function.name} não encontrada`;
      } catch (e) {
        result = `Erro: ${e instanceof Error ? e.message : String(e)}`;
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
  return "Um instante, estou verificando a disponibilidade...";
}
