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
          visual_text: { type: "string" },
          visual_query: { type: "string" },
          narration: { type: "string" },
          claim_ids: { type: "array", items: { type: "string" } }
        },
        required: ["title", "visual_text", "visual_query", "narration", "claim_ids"]
      }
    }
  },
  required: ["title", "hook", "scenes"]
};
