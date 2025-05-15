import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Ollama } from "ollama";

import readline from "readline/promises";

class OllamaMCPClient {
    private ollama = new Ollama();
    private mcpClient = new Client({ name: "mcp-client-cli", version: "1.0.0" });
    private transport!: StdioClientTransport;
    private tools: any[] = [];

    async connect(serverPath: string) {
        // Start MCP server
        this.transport = new StdioClientTransport({
            command: serverPath.endsWith(".js") ? "node" : "python3",
            args: [serverPath],
        });

        await this.mcpClient.connect(this.transport);

        // Get and transform tools
        const serverTools = await this.mcpClient.listTools();
        this.tools = serverTools.tools.map((tool) => ({
            type: "function",
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
            },
        }));
    }

    async processQuery(query: string) {
        const response = await this.ollama.chat({
            model: "qwen3:14b",
            messages: [{ role: "user", content: query }],
            tools: this.tools,
            stream: false,
        });

        // Handle tool calls
        if (response.message.tool_calls) {
            const toolOutputs: string[] = [];
            for (const tool_call of response.message.tool_calls) {
                console.log(JSON.stringify(tool_call));
                const result: any = await this.mcpClient.callTool({
                    name: tool_call.function.name,
                    arguments: tool_call.function.arguments,
                });
                toolOutputs.push(JSON.stringify(result.content));
            }

            // Pass tool outputs back through Ollama for better formatting
            const formattedResponse = await this.ollama.chat({
                model: "gemma3:27b",
                messages: [
                    {
                        role: "system",
                        content:
                            "Here are the results from the tools:\n" +
                            toolOutputs.join("\n") +
                            "\n\nPlease provide a clear and concise summary of this information, focusing on the most relevant details.",
                    },
                ],
                stream: false,
            });

            return formattedResponse.message.content;
        }
        return response.message.content;
    }
}

async function main() {
    const client = new OllamaMCPClient();
    await client.connect("./jiral.js");

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    while (true) {
        const query = await rl.question("> ");
        const response = await client.processQuery(query);
        console.log(response);
    }
}

main();
