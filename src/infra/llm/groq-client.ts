import type { LlmClient } from '../../modules/restaurants/search/llm-query-parser.js';

export interface GroqOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  baseUrl?: string;
}

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
        max_tokens: 400,
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
