import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type DriversnoteEnv = Env & {
  DRIVERSNOTE_API_KEY: string;
};

async function driversnoteRequest(
  apiKey: string,
  query: string,
  variables: Record<string, unknown> = {}
) {
  const response = await fetch("https://api.driversnote.com/v1/driversnote", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Driversnote HTTP error ${response.status}`);
  }

  if (data.errors) {
    throw new Error(JSON.stringify(data.errors));
  }

  return data.data;
}

export class MyMCP extends McpAgent<DriversnoteEnv> {
  server = new McpServer({
    name: "CGA Driversnote",
    version: "1.0.0",
  });

  async init() {
    this.server.tool(
      "list_driversnote_trips",
      "Lire les trajets Driversnote d'une période afin de les rapprocher des chantiers, clients et déplacements professionnels.",
      {
        startDate: z.string().describe("Date de début au format YYYY-MM-DD"),
        endDate: z.string().describe("Date de fin au format YYYY-MM-DD"),
      },
      async ({ startDate, endDate }) => {
        const query = `
          query Trips($startDate: ISO8601Date!, $endDate: ISO8601Date!) {
            trips(startDate: $startDate, endDate: $endDate, first: 100) {
              totalCount
              nodes {
                id
                startAt
                stopAt
                distance
                comment
                reviewStatus
                routeOrigin
                startLocationPlaceholder
                stopLocationPlaceholder
                tripType {
                  id
                  name
                }
                tags {
                  id
                  name
                }
                vehicle {
                  id
                  name
                  licensePlate
                }
              }
            }
          }
        `;

        const data = await driversnoteRequest(
          this.env.DRIVERSNOTE_API_KEY,
          query,
          { startDate, endDate }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data.trips, null, 2),
            },
          ],
        };
      }
    );

    this.server.tool(
      "update_driversnote_trip",
      "Modifier le motif d'un trajet Driversnote. Utiliser seulement après avoir identifié le déplacement professionnel et obtenu confirmation de l'utilisateur.",
      {
        tripId: z.string().describe("Identifiant Driversnote du trajet"),
        comment: z.string().describe(
          "Motif professionnel précis, par exemple : Visite chantier Retali - Folelli"
        ),
        tripTypeId: z.string().optional().describe(
          "Identifiant du type de trajet Driversnote si une modification du type est nécessaire"
        ),
      },
      async ({ tripId, comment, tripTypeId }) => {
        const attributes: Record<string, unknown> = { comment };

        if (tripTypeId) {
          attributes.tripTypeId = tripTypeId;
        }

        const query = `
          mutation UpdateTrip($input: TripUpdateMutationInput!) {
            tripUpdate(input: $input) {
              trip {
                id
                comment
                reviewStatus
                tripType {
                  id
                  name
                }
              }
            }
          }
        `;

        const data = await driversnoteRequest(
          this.env.DRIVERSNOTE_API_KEY,
          query,
          {
            input: {
              id: tripId,
              attributes,
              markAsReviewed: true,
            },
          }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data.tripUpdate.trip, null, 2),
            },
          ],
        };
      }
    );
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      // @ts-ignore
      return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
    }

    if (url.pathname === "/mcp") {
      // @ts-ignore
      return MyMCP.serve("/mcp").fetch(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
};
