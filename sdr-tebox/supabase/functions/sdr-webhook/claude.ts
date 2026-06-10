// Cliente Claude (Anthropic) — substitui os nós "OpenAI Chat Model"/"OpenAI Chat Model1"
// e o loop interno dos agentes LangChain do n8n, agora usando a API do Claude
// com tool use nativo e adaptive thinking.

// Import dinâmico: o specifier npm: só resolve no Deno (Supabase Edge Functions);
// carregando sob demanda, os testes locais do funil rodam sem o SDK instalado.
import type AnthropicType from "npm:@anthropic-ai/sdk";

let client: AnthropicType | null = null;

async function getClient(): Promise<AnthropicType> {
  if (!client) {
    const { default: Anthropic } = await import("npm:@anthropic-ai/sdk");
    client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
  }
  return client;
}

const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-opus-4-8";

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<string>;
}

// Executa o agente: chama o Claude e resolve tool calls em loop (máx. 8 rodadas),
// como o nó Agent do n8n fazia internamente.
export async function runAgent(
  system: string,
  history: { role: string; content: string }[],
  userText: string,
  tools: ToolDef[] = [],
): Promise<string> {
  const anthropic = await getClient();

  const anthropicTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as AnthropicType.Tool.InputSchema,
  }));

  // A API exige que a primeira mensagem seja do usuário — descarta um eventual
  // prefixo de mensagens do assistente vindo da janela de memória.
  const firstUser = history.findIndex((m) => m.role === "user");
  const trimmed = firstUser === -1 ? [] : history.slice(firstUser);

  const messages: AnthropicType.MessageParam[] = [
    ...trimmed.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user" as const, content: userText },
  ];

  for (let i = 0; i < 8; i++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system,
      messages,
      ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
    });

    if (response.stop_reason === "tool_use") {
      // Ecoa o turno completo do assistente (preserva blocos de thinking/tool_use)
      messages.push({ role: "assistant", content: response.content });

      const results: AnthropicType.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const tool = tools.find((t) => t.name === block.name);
        let result: string;
        let isError = false;
        try {
          result = tool
            ? await tool.run(block.input as Record<string, unknown>)
            : `Tool ${block.name} não encontrada`;
        } catch (e) {
          result = `Erro: ${e instanceof Error ? e.message : String(e)}`;
          isError = true;
        }
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
          ...(isError ? { is_error: true } : {}),
        });
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    return response.content
      .filter((b): b is AnthropicType.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  }
  return "Um instante, estou verificando a disponibilidade...";
}
