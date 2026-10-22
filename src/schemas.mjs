export const researchSchema = {
  type: "object",
  properties: {
    topic: { type: "string" },
    summary: { type: "string" },
    claims: {
      type: "array", minItems: 5, maxItems: 12,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          claim: { type: "string" },
          support: { type: "string", enum: ["supported", "uncertain", "unsupported"] },
          sources: {
            type: "array",
            items: {
              type: "object",
              properties: { url: { type: "string" }, title: { type: "string" } },
              required: ["url", "title"]
            }
          }
        },
        required: ["id", "claim", "support", "sources"]
      }
    }
  },
  required: ["topic", "summary", "claims"]
};

// Generic element categories; each maps to an icon in remotion/icons.js. They are listed in the prompt rather
// than as a schema enum because a large nested enum makes Gemini reject the schema (HTTP 400).
export const ELEMENT_KINDS = [
  "user", "users", "browser", "mobile", "server", "database", "cache", "storage", "file", "api", "queue",
  "load-balancer", "cdn", "cloud", "network", "lock", "key", "security", "token", "code", "terminal", "function",
  "container", "settings", "time", "metrics", "bug", "email", "notification", "compute", "search", "success",
  "warning", "deploy", "cost", "package", "layers", "performance", "sync", "workflow", "webhook", "archive",
  "identity", "monitoring", "message", "scale"
];

export const SCENE_LAYOUTS = ["flow", "compare", "stat", "list", "focus"];

export const scriptSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    hook: { type: "string" },
    scenes: {
      type: "array", minItems: 5, maxItems: 8,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          narration: { type: "string" },
          claim_ids: { type: "array", items: { type: "string" } },
          layout: { type: "string", enum: SCENE_LAYOUTS },
          elements: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                kind: { type: "string" },
                is_product: { type: "boolean" }
              },
              required: ["name", "kind", "is_product"]
            }
          },
          points: { type: "array", items: { type: "string" } },
          stat_value: { type: "string" },
          stat_label: { type: "string" }
        },
        required: ["title", "narration", "claim_ids", "layout", "elements", "points", "stat_value", "stat_label"]
      }
    }
  },
  required: ["title", "hook", "scenes"]
};
