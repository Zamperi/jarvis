import { openaiClient, azureConfig } from "../config/azure";
import { readFileSafe, writeFileSafe } from "../tools/fileTools";

export interface AgentMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const tools: any[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Lue tiedoston sisältö suhteellisella polulla projektin juuresta.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Tiedoston suhteellinen polku projektin juuresta, esim. src/components/MovieCard.tsx"
          }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Kirjoita tai korvaa tiedosto suhteellisella polulla projektin juuresta. Käytä tätä vain kun käyttäjä pyytää nimenomaan muutosta.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Tiedoston suhteellinen polku projektin juuresta, esim. src/components/MovieCard.tsx"
          },
          content: {
            type: "string",
            description: "Kirjoitettava sisältö kokonaan."
          }
        },
        required: ["path", "content"]
      }
    }
  }
];

export async function runAgent(messages: AgentMessage[]): Promise<string> {
  const openaiMessages: any[] = messages.map((m) => ({
    role: m.role,
    content: m.content
  }));

  // max 3 tool-kierrosta
  for (let i = 0; i < 3; i++) {
    const response = await openaiClient.chat.completions.create({
      model: azureConfig.deployment,
      messages: openaiMessages,
      tools,
      tool_choice: "auto"
    });

    const choice = response.choices[0];
    if (!choice) {
      throw new Error("Azure OpenAI ei palauttanut valintoja.");
    }

    const msg: any = choice.message;

    // TOOL CALLIT
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      // assistant-viesti, jossa tool_calls
      openaiMessages.push({
        role: "assistant",
        content: msg.content ?? "",
        tool_calls: msg.tool_calls
      });

      // suoritetaan jokainen tool call
      for (const toolCallAny of msg.tool_calls as any[]) {
        const fn = toolCallAny.function as { name: string; arguments: string };
        const toolName = fn.name;
        const rawArgs = fn.arguments || "{}";

        let parsedArgs: any;
        try {
          parsedArgs = JSON.parse(rawArgs);
        } catch {
          parsedArgs = {};
        }

        let toolResult: string;

        try {
          if (toolName === "read_file") {
            if (!parsedArgs.path || typeof parsedArgs.path !== "string") {
              throw new Error("read_file: path puuttuu tai ei ole string.");
            }
            const content = await readFileSafe(parsedArgs.path);
            toolResult = content;
          } else if (toolName === "write_file") {
            if (!parsedArgs.path || typeof parsedArgs.path !== "string") {
              throw new Error("write_file: path puuttuu tai ei ole string.");
            }
            if (typeof parsedArgs.content !== "string") {
              throw new Error("write_file: content täytyy olla string.");
            }
            await writeFileSafe(parsedArgs.path, parsedArgs.content);
            toolResult = `Tiedosto '${parsedArgs.path}' kirjoitettu onnistuneesti.`;
          } else {
            toolResult = `Tuntematon työkalu: ${toolName}`;
          }
        } catch (err: any) {
          toolResult = `Työkalun ${toolName} suoritus epäonnistui: ${err.message ?? String(err)}`;
        }

        // tool-vastaus takaisin mallille
        openaiMessages.push({
          role: "tool",
          tool_call_id: toolCallAny.id,
          content: toolResult
        });
      }

      // uusi kierros, nyt malli näkee toolien tulokset
      continue;
    }

    // Ei tool-calleja → lopullinen vastaus
    if (!msg.content) {
      throw new Error("Azure OpenAI ei palauttanut sisältöä.");
    }

    return msg.content as string;
  }

  throw new Error("Tool calling -loopin maksimimäärä (3) ylittyi.");
}
