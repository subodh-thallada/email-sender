import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import * as z from "zod";
import { EFFORT, UPGRADES, type Provider, type Task } from "./models";
import { resolveTask } from "../settings";

/**
 * One surface over Anthropic, OpenAI, and OpenRouter. Every AI call goes
 * through generateObject(), streamText(), or chat(), so switching provider or
 * model is a settings change and nothing else moves.
 */

let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;
let routerClient: OpenAI | null = null;

function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set.");
  anthropicClient ??= new Anthropic();
  return anthropicClient;
}

function openai(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set.");
  openaiClient ??= new OpenAI();
  return openaiClient;
}

/** OpenRouter speaks the OpenAI wire format, so the same SDK drives it. */
function openrouter(): OpenAI {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set.");
  routerClient ??= new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": process.env.APP_URL ?? "http://localhost:3000",
      "X-Title": "Email Agent",
    },
  });
  return routerClient;
}

function oaiFor(provider: Provider): OpenAI {
  return provider === "openrouter" ? openrouter() : openai();
}

/** 429 / 5xx — worth trying a different model. 400s are not. */
function isTransient(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  return status === 429 || status === 502 || status === 503 || (status ?? 0) >= 500;
}

/**
 * OpenRouter's free models sit behind a shared upstream pool and return 429
 * whenever that pool is busy, which is often. Falling back through the other
 * free models for the same task is the difference between "free tier" and
 * "free tier that works".
 *
 * Paid providers get no fallback: a 429 there means your own quota, and
 * silently retrying on a pricier model would spend money you didn't ask to.
 */
function candidateModels(provider: Provider, task: Task, first: string): string[] {
  if (provider !== "openrouter") return [first];
  return [...new Set([first, ...(UPGRADES.openrouter[task] ?? [])])];
}

export interface Call {
  task: Task;
  system: string;
  user: string;
  maxTokens?: number;
}

export async function generateObject<S extends z.ZodType>(
  schema: S,
  { task, system, user, maxTokens = 8000 }: Call,
  schemaName = "result",
): Promise<z.infer<S> | null> {
  const { provider, model } = await resolveTask(task);
  const effort = EFFORT[task];

  if (provider === "anthropic") {
    const res = await anthropic().messages.parse({
      model,
      max_tokens: maxTokens,
      system,
      output_config: { effort, format: zodOutputFormat(schema) },
      messages: [{ role: "user", content: user }],
    });
    return res.parsed_output ?? null;
  }

  const client = oaiFor(provider);
  const models = candidateModels(provider, task, model);
  let lastTransient: unknown = null;

  for (const candidate of models) {
    try {
      const res = await client.chat.completions.parse({
        model: candidate,
        ...(provider === "openai" ? { reasoning_effort: effort } : {}),
        max_completion_tokens: maxTokens,
        response_format: zodResponseFormat(schema, schemaName),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      const parsed = res.choices[0]?.message.parsed as z.infer<S> | undefined;
      if (parsed) return parsed;
    } catch (err) {
      if (provider === "openai") throw err;
      if (isTransient(err)) {
        lastTransient = err;
        console.warn(`${candidate} unavailable (${(err as { status?: number }).status}), trying next`);
        continue;
      }
      // Not transient: the model likely advertises json_schema without
      // honouring it. Ask for plain JSON on this same model instead.
      console.warn(`json_schema failed on ${candidate}, retrying as plain JSON`);
    }

    try {
      const out = await jsonFallback(
        client, candidate, schema, system, user, maxTokens,
      );
      if (out) return out;
    } catch (err) {
      if (!isTransient(err)) throw err;
      lastTransient = err;
    }
  }

  if (lastTransient) throw lastTransient;
  return null;
}

/**
 * Last resort for models without working structured outputs: ask for raw JSON,
 * strip any code fence, and validate with the same zod schema. One retry, with
 * the validation error fed back.
 */
async function jsonFallback<S extends z.ZodType>(
  client: OpenAI,
  model: string,
  schema: S,
  system: string,
  user: string,
  maxTokens: number,
): Promise<z.infer<S> | null> {
  const shape = JSON.stringify(z.toJSONSchema(schema));
  let lastError = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await client.chat.completions.create({
      model,
      max_completion_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `${system}\n\nReply with JSON only — no prose, no code fence. It must validate against this JSON Schema:\n${shape}`,
        },
        { role: "user", content: user },
        ...(lastError
          ? [
              {
                role: "user" as const,
                content: `Your last reply failed validation: ${lastError}. Return corrected JSON only.`,
              },
            ]
          : []),
      ],
    });

    const raw = res.choices[0]?.message.content ?? "";
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```$/, "")
      .trim();

    try {
      return schema.parse(JSON.parse(cleaned)) as z.infer<S>;
    } catch (e) {
      lastError = e instanceof Error ? e.message.slice(0, 300) : String(e);
    }
  }
  return null;
}

/** Plain-text stream, used for drafting. */
export function streamText(call: Call): ReadableStream<Uint8Array> {
  return streamMessages(call.task, [
    { role: "system", content: call.system },
    { role: "user", content: call.user },
  ], call.maxTokens ?? 16000);
}

export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Non-streaming text. Bulk drafting needs this: twenty concurrent streams have
 * nowhere to stream *to*, and unlike streamMessages a failure here has to be
 * throwable so one bad draft can be reported per person instead of being
 * written into the body as an error string.
 */
export async function generateText({
  task,
  system,
  user,
  maxTokens = 16000,
}: Call): Promise<string> {
  const { provider, model } = await resolveTask(task);
  const effort = EFFORT[task];

  if (provider === "anthropic") {
    const res = await anthropic().messages.create({
      model,
      max_tokens: maxTokens,
      system,
      output_config: { effort },
      messages: [{ role: "user", content: user }],
    });
    return res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
  }

  const client = oaiFor(provider);
  let lastErr: unknown = null;

  for (const candidate of candidateModels(provider, task, model)) {
    try {
      const res = await client.chat.completions.create({
        model: candidate,
        ...(provider === "openai" ? { reasoning_effort: effort } : {}),
        max_completion_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      const text = res.choices[0]?.message.content?.trim();
      if (text) return text;
      lastErr = new Error(`${candidate} returned an empty completion.`);
    } catch (err) {
      lastErr = err;
      if (!isTransient(err)) break;
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error("No model produced a draft.");
}

/** Multi-turn stream, used by draft chat. */
export function streamMessages(
  task: Task,
  messages: ChatTurn[],
  maxTokens = 16000,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        const { provider, model } = await resolveTask(task);
        const effort = EFFORT[task];
        const system = messages
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n\n");
        const rest = messages.filter((m) => m.role !== "system");

        if (provider === "anthropic") {
          const stream = anthropic().messages.stream({
            model,
            max_tokens: maxTokens,
            system,
            output_config: { effort },
            messages: rest.map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
          });
          stream.on("text", (d) => controller.enqueue(encoder.encode(d)));
          await stream.finalMessage();
        } else {
          const client = oaiFor(provider);
          const payload = [
            ...(system ? [{ role: "system" as const, content: system }] : []),
            ...rest.map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
          ];

          let opened = false;
          let lastErr: unknown = null;

          for (const candidate of candidateModels(provider, task, model)) {
            try {
              const stream = await client.chat.completions.create({
                model: candidate,
                ...(provider === "openai" ? { reasoning_effort: effort } : {}),
                max_completion_tokens: maxTokens,
                stream: true,
                messages: payload,
              });
              for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta?.content;
                if (delta) {
                  opened = true;
                  controller.enqueue(encoder.encode(delta));
                }
              }
              lastErr = null;
              break;
            } catch (err) {
              lastErr = err;
              // Once bytes are out the door we cannot restart on another
              // model without duplicating text — surface the error instead.
              if (opened || !isTransient(err)) break;
            }
          }
          if (lastErr) throw lastErr;
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `\n\n[generation failed: ${err instanceof Error ? err.message : String(err)}]`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });
}
