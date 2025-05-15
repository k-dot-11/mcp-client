import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({path : path.resolve(__dirname , ".env")});

const JIRA_API = process.env.JIRA_API
const JIRA_DOMAIN = process.env.JIRA_DOMAIN
const JIRA_EMAIL = process.env.JIRA_EMAIL;

// Base configuration for Jira API
const jiraInstance = axios.create({
    baseURL: `${JIRA_DOMAIN}/rest/api/3`,
    headers: {
        Authorization: `Basic ${Buffer.from(
            `${JIRA_EMAIL}:${JIRA_API}`
        ).toString("base64")}`,
        Accept: "application/json",
        "Content-Type": "application/json",
    },
});

// Create an MCP server
const server = new McpServer({
    name: "Jira MCP Server",
    version: "1.0.0",
    description: "MCP server for interacting with Jira API",
});

// Tool: Get Issue
server.tool(
    "get_issue",
    {
        issueKey: z
            .string()
            .describe("The key of the issue to retrieve (e.g., PROJ-123)"),
    },
    async ({ issueKey }) => {
        try {
            const response = await jiraInstance.get(`/issue/${issueKey}`);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(response.data, null, 2),
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error fetching issue: ${error.message}`,
                    },
                ],
            };
        }
    }
);

// Tool: Create Issue
server.tool(
    "create_issue",
    {
        projectKey: z.string().describe("The project key (e.g., PROJ)"),
        issueType: z
            .string()
            .describe("The issue type (e.g., Bug, Task, Story)"),
        summary: z.string().describe("The issue summary"),
        description: z.string().optional().describe("The issue description"),
        priority: z.string().optional().describe("The priority of the issue"),
    },
    async ({ projectKey, issueType, summary, description, priority }) => {
        try {
            const issueData = {
                fields: {
                    project: { key: projectKey },
                    issuetype: { name: issueType },
                    summary: summary,
                },
            };

            if (description) {
                issueData.fields.description = {
                    type: "doc",
                    version: 1,
                    content: [
                        {
                            type: "paragraph",
                            content: [{ type: "text", text: description }],
                        },
                    ],
                };
            }

            if (priority) {
                issueData.fields.priority = { name: priority };
            }

            const response = await jiraInstance.post("/issue", issueData);
            return {
                content: [
                    {
                        type: "text",
                        text: `Issue created successfully. Key: ${response.data.key}`,
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error creating issue: ${error.message}`,
                    },
                ],
            };
        }
    }
);

// Tool: Update Issue
server.tool(
    "update_issue",
    {
        issueKey: z
            .string()
            .describe("The key of the issue to update (e.g., PROJ-123)"),
        summary: z.string().optional().describe("The updated summary"),
        description: z.string().optional().describe("The updated description"),
        status: z.string().optional().describe("The new status"),
        priority: z.string().optional().describe("The new priority"),
    },
    async ({ issueKey, summary, description, status, priority }) => {
        try {
            const updateData = { fields: {} };

            if (summary) {
                updateData.fields.summary = summary;
            }

            if (description) {
                updateData.fields.description = {
                    type: "doc",
                    version: 1,
                    content: [
                        {
                            type: "paragraph",
                            content: [{ type: "text", text: description }],
                        },
                    ],
                };
            }

            if (priority) {
                updateData.fields.priority = { name: priority };
            }

            // Status updates require transition ID, which needs an additional API call
            if (status) {
                const transitions = await jiraInstance.get(
                    `/issue/${issueKey}/transitions`
                );
                const transition = transitions.data.transitions.find(
                    (t) => t.name.toLowerCase() === status.toLowerCase()
                );

                if (transition) {
                    await jiraInstance.post(`/issue/${issueKey}/transitions`, {
                        transition: { id: transition.id },
                    });
                } else {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Status "${status}" not found in available transitions`,
                            },
                        ],
                    };
                }
            }

            // Only make the update API call if there are fields to update
            if (Object.keys(updateData.fields).length > 0) {
                await jiraInstance.put(`/issue/${issueKey}`, updateData);
            }

            return {
                content: [
                    {
                        type: "text",
                        text: `Issue ${issueKey} updated successfully`,
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error updating issue: ${error.message}`,
                    },
                ],
            };
        }
    }
);

// Tool: Search Issues
server.tool(
    "search_issues",
    {
        jql: z.string().describe("The JQL query string"),
        maxResults: z
            .number()
            .min(1)
            .max(100)
            .default(50)
            .describe("Maximum number of results to return"),
    },
    async ({ jql, maxResults }) => {
        try {
            const response = await jiraInstance.post("/search", {
                jql: jql,
                maxResults: maxResults,
            });

            // Format the results in a more readable way
            const formattedResults = response.data.issues.map((issue) => ({
                key: issue.key,
                summary: issue.fields.summary,
                status: issue.fields.status.name,
                priority: issue.fields.priority?.name,
                created: issue.fields.created,
                updated: issue.fields.updated,
            }));

            return {
                content: [
                    {
                        type: "text",
                        text: `Found ${response.data.total} issues. Showing ${
                            formattedResults.length
                        }:\n\n${JSON.stringify(formattedResults, null, 2)}`,
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error searching issues: ${error.message}`,
                    },
                ],
            };
        }
    }
);

// Tool: Add Comment to Issue
server.tool(
    "add_comment",
    {
        issueKey: z
            .string()
            .describe("The key of the issue to comment on (e.g., PROJ-123)"),
        comment: z.string().describe("The comment text"),
    },
    async ({ issueKey, comment }) => {
        try {
            const commentData = {
                body: {
                    type: "doc",
                    version: 1,
                    content: [
                        {
                            type: "paragraph",
                            content: [{ type: "text", text: comment }],
                        },
                    ],
                },
            };

            await jiraInstance.post(`/issue/${issueKey}/comment`, commentData);
            return {
                content: [
                    {
                        type: "text",
                        text: `Comment added to issue ${issueKey} successfully`,
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error adding comment: ${error.message}`,
                    },
                ],
            };
        }
    }
);

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
console.log("Jira MCP Server starting...");
console.log(`${JIRA_EMAIL}:${JIRA_API}`)
await server.connect(transport);