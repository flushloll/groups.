import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { attachedImages, planSchema, roomContext } from "./room-tools.mjs";

export async function handleMcp(request, response, url, access) {
  const token = process.env.GROUPS_MCP_TOKEN;
  const supplied = request.headers.authorization?.replace(/^Bearer /, "") || "";
  if (!token || token.length < 32) {
    response
      .writeHead(503)
      .end(
        "Configure GROUPS_MCP_TOKEN with at least 32 characters to enable MCP.",
      );
    return;
  }
  if (
    Buffer.byteLength(supplied) !== Buffer.byteLength(token) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
  ) {
    response
      .writeHead(401, { "WWW-Authenticate": "Bearer" })
      .end("Unauthorized");
    return;
  }
  if (
    request.headers.origin &&
    request.headers.origin !==
      `${request.socket.encrypted ? "https" : "http"}://${request.headers.host}`
  ) {
    response.writeHead(403).end("Origin is not allowed.");
    return;
  }
  const workspaceId = url.searchParams.get("space");
  const roomId = url.searchParams.get("room");
  const session = await access.getSession(workspaceId);
  if (!session || !session.workspace.rooms.some((room) => room.id === roomId)) {
    response.writeHead(404).end("Choose an existing workspace and room.");
    return;
  }
  if (request.method !== "POST") {
    response.writeHead(405, { Allow: "POST" }).end();
    return;
  }
  const server = new McpServer({ name: "groups-room", version: "1.0.0" });
  const asContent = (value) => ({
    content: [{ type: "text", text: JSON.stringify(value) }],
  });
  server.registerTool(
    "get_room_context",
    {
      description:
        "Read this room's spatial objects, notes, paintings, speech and ancestry. Includes up to four reference images. Use the returned revision for edits.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const room = session.workspace.rooms.find((item) => item.id === roomId);
      const result = asContent(roomContext(session.workspace, roomId));
      for (const image of attachedImages(room)) {
        const [header, data] = image.image.split(",");
        result.content.push({
          type: "image",
          mimeType: header.slice(5, header.indexOf(";")),
          data,
        });
      }
      return result;
    },
  );
  server.registerTool(
    "apply_room_operations",
    {
      description:
        "Atomically edit this live room with validated spatial operations. Saves its previous state as a checkpoint. Stale revisions and consumed source turns are rejected.",
      inputSchema: planSchema.extend({
        sourceTurnIds: z.array(z.string().max(80)).max(2000).optional(),
      }),
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ sourceTurnIds = [], ...plan }) => {
      try {
        return asContent(
          await access.commit(session, roomId, plan, sourceTurnIds),
        );
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: error.message }],
        };
      }
    },
  );
  server.registerResource(
    "room",
    `groups://workspaces/${workspaceId}/rooms/${roomId}`,
    {
      description: "Current spatial room context",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(roomContext(session.workspace, roomId)),
        },
      ],
    }),
  );
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  response.on("close", () => {
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(request, response);
}
