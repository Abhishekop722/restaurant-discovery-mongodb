import type { LlmClient } from '../../modules/restaurants/search/llm-query-parser.js';

export interface GroqOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  baseUrl?: string;
}

/** Reasoning models spend tokens thinking before they answer, so leave room for both. */
const MAX_COMPLETION_TOKENS = 1000;

/** `reasoning_effort` is only accepted by the gpt-oss models; other models reject it. */
const supportsReasoningEffort = (model: string): boolean => model.startsWith('openai/gpt-oss');

interface ChatCompletion {
  choices?: { message?: { content?: string | null } }[];
}

/** Groq's OpenAI-compatible chat endpoint in JSON mode. Throws on any failure; the caller falls back. */
export function createGroqClient({
  apiKey,
  model,
  timeoutMs,
  baseUrl = 'https://api.groq.com/openai/v1',
}: GroqOptions): LlmClient {
  return async ({ system, user }) => {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        // extraction needs little thinking, which keeps latency and token use down
        ...(supportsReasoningEffort(model) && { reasoning_effort: 'low' }),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`groq responded ${String(response.status)}`);
    const content = ((await response.json()) as ChatCompletion).choices?.[0]?.message?.content;
    if (!content) throw new Error('groq returned no content');
    return content;
  };
}
