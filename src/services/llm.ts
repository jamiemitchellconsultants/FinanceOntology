import { AzureOpenAI } from 'openai';

export interface IngestionMappingProposal {
  incomingField: string;
  /** Must cross-reference an existing concept ID from the ontology */
  mappedConceptId: string;
  /** Confidence in the mapping, 0.0–1.0 */
  confidence: number;
  /** Brief architecture-driven justification */
  reasoning: string;
}

export type LlmTier = 'architect' | 'workhorse';

export const HIGH_CONFIDENCE_THRESHOLD = 0.85;

const TIER_MODELS: Record<LlmTier, string> = {
  architect: 'gpt-4o',    // structural tasks: schema mapping, MCP ingestion
  workhorse: 'gpt-4o-mini', // high-volume: transactional field resolution
};

export interface ConceptSummary {
  id: string;
  name: string;
  type: string;
  description: string;
}

export interface MappingContext {
  systemName: string;
  systemType: string;
  incomingFields: Array<{ name: string; description?: string }>;
}

// Root schema must be an object; proposals are nested under "proposals"
const PROPOSALS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          incomingField: { type: 'string' },
          mappedConceptId: { type: 'string' },
          confidence: { type: 'number' },
          reasoning: { type: 'string' },
        },
        required: ['incomingField', 'mappedConceptId', 'confidence', 'reasoning'],
        additionalProperties: false,
      },
    },
  },
  required: ['proposals'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are a finance domain ontology mapping expert. Your task is to map incoming data fields from an external system to existing concepts in a finance ontology.

RULES:
- mappedConceptId MUST be one of the concept IDs provided — never invent IDs
- Set confidence >= 0.85 ONLY when you are certain the mapping is correct
- For ambiguous or uncertain matches, use confidence < 0.85 and explain why in reasoning
- reasoning must be concise (1–2 sentences) referencing finance domain semantics`;

export class LlmService {
  private readonly client: AzureOpenAI | null = null;
  private readonly ready: boolean;

  constructor() {
    const endpoint = process.env['AZURE_OPENAI_ENDPOINT'];
    const apiKey = process.env['AZURE_OPENAI_KEY'];

    if (endpoint && apiKey) {
      this.client = new AzureOpenAI({
        endpoint,
        apiKey,
        apiVersion: process.env['AZURE_OPENAI_API_VERSION'] ?? '2024-08-01-preview',
      });
      this.ready = true;
    } else {
      this.ready = false;
      process.stderr.write(
        'LlmService: AZURE_OPENAI_ENDPOINT or AZURE_OPENAI_KEY not set — LLM-enhanced ingestion disabled\n'
      );
    }
  }

  isAvailable(): boolean {
    return this.ready;
  }

  /**
   * Ask the LLM to propose ontology concept mappings for a set of incoming fields.
   *
   * Uses gpt-4o (architect) for structural metadata tasks and gpt-4o-mini (workhorse)
   * for high-volume transactional field resolution.
   */
  async proposeMappings(
    tier: LlmTier,
    context: MappingContext,
    existingConcepts: ConceptSummary[]
  ): Promise<IngestionMappingProposal[]> {
    if (!this.client) return [];

    const userContent = `System being ingested: ${context.systemName} (type: ${context.systemType})

Incoming fields to classify:
${JSON.stringify(context.incomingFields, null, 2)}

Available ontology concepts — use one of these IDs in mappedConceptId:
${JSON.stringify(existingConcepts, null, 2)}

For each incoming field, propose the best-matching existing concept.`;

    const response = await this.client.chat.completions.create({
      model: TIER_MODELS[tier],
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'ingestion_mapping_proposals',
          strict: true,
          schema: PROPOSALS_JSON_SCHEMA,
        },
      },
      temperature: 0,
    });

    const raw = response.choices[0]?.message.content ?? '{"proposals":[]}';
    try {
      const parsed = JSON.parse(raw) as { proposals?: unknown[] };
      return (parsed.proposals ?? []).filter(isValidProposal);
    } catch {
      process.stderr.write('LlmService: failed to parse response JSON — returning empty proposals\n');
      return [];
    }
  }
}

function isValidProposal(p: unknown): p is IngestionMappingProposal {
  if (typeof p !== 'object' || p === null) return false;
  const obj = p as Record<string, unknown>;
  return (
    typeof obj['incomingField'] === 'string' &&
    typeof obj['mappedConceptId'] === 'string' &&
    typeof obj['confidence'] === 'number' &&
    obj['confidence'] >= 0 &&
    obj['confidence'] <= 1 &&
    typeof obj['reasoning'] === 'string'
  );
}
