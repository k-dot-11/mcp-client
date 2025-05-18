import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Ollama } from "ollama";
import readline from "readline/promises";

interface OllamaMCPClientOptions {
    debug?: boolean;
    chunkDelay?: number;
}

export class OllamaMCPClient {
    private ollama = new Ollama();
    private mcpClient = new Client({ name: "mcp-client-cli", version: "1.0.0" });
    private transport!: StdioClientTransport;
    private tools: any[] = [];
    private debug: boolean;
    private chunkDelay: number;

    constructor(options: OllamaMCPClientOptions = {}) {
        this.debug = options.debug || false;
        this.chunkDelay = options.chunkDelay || 50;
    }

    async connect(serverPath: string) {
        this.transport = new StdioClientTransport({
            command: serverPath.endsWith(".js") ? "node" : "python3",
            args: [serverPath],
        });

        await this.mcpClient.connect(this.transport);
        const serverTools = await this.mcpClient.listTools();

        this.tools = serverTools.tools.map((tool) => ({
            type: "function",
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
            },
        }));

        if (this.debug) {
            console.debug(
                "Registered tools:",
                this.tools.map((t) => t.function.name)
            );
        }
    }

    async *processQuery(query: string) {
        const startTime = Date.now();

        try {
            // Initial streaming request
            const initialStream = await this.ollama.chat({
                model: "qwen3:14b",
                messages: [{ role: "user", content: query }],
                tools: this.tools,
                stream: true,
                options: {
                    num_predict: 512,
                    temperature: 0.7,
                    num_ctx: 2048,
                },
            });

            let toolCalls: any[] | undefined;

            // Process initial stream chunks
            for await (const chunk of initialStream) {
                if (chunk.message.tool_calls) {
                    toolCalls = chunk.message.tool_calls;
                    break;
                }
                if (chunk.message.content) {
                    yield chunk.message.content;
                    await this.chunkThrottle();
                }
            }

            // Handle tool calls if detected
            if (toolCalls) {
                yield "\n[Processing tool requests...]\n";
                const toolOutputs: string[] = [];

                for (const tool_call of toolCalls) {
                    yield `\n⚙️ Calling ${tool_call.function.name}... `;
                    await this.chunkThrottle();

                    try {
                        const result = await this.mcpClient.callTool({
                            name: tool_call.function.name,
                            arguments: tool_call.function.arguments,
                        });

                        toolOutputs.push(JSON.stringify(result.content));
                        yield `✅ ${tool_call.function.name} completed!\n`;
                    } catch (error) {
                        yield `❌ ${tool_call.function.name} failed: ${error.message}\n`;
                    }
                    await this.chunkThrottle();
                }

                // Stream formatted response
                const formattedStream = await this.ollama.chat({
                    model: "qwen3:14b",
                    messages: [
                        {
                            role: "system",
                            content: `Tool results:\n${toolOutputs.join(
                                "\n"
                            )}\n\nSummarize these findings clearly and concisely.`,
                        },
                    ],
                    stream: true,
                });

                for await (const chunk of formattedStream) {
                    yield chunk.message.content;
                    await this.chunkThrottle();
                }
            }
        } finally {
            if (this.debug) {
                console.log(`⏱️ Total processing time: ${Date.now() - startTime}ms`);
            }
        }
    }

    private async chunkThrottle() {
        if (this.chunkDelay > 0) {
            await new Promise((resolve) => setTimeout(resolve, this.chunkDelay));
        }
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
        const stream = client.processQuery(query);

        // Stream response chunks with typing indicator
        process.stdout.write("🤖 ");
        for await (const chunk of stream) {
            process.stdout.write(chunk);
        }
        console.log("\n");
    }
}

main();
