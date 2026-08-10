import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type * as z from "zod";
import {
  activeProvider,
  EFFORT,
  modelFor,
  type Provider,
  type Task,
} from "./models";

/**
 * One surface over both vendors. Every AI call in the app goes through
 * generateObject() or streamText(), so swapping providers is an env var and
 * nothing else changes.
 */

let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;

function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }
  anthropicClient ??= new Anthropic();
  return anthropicClient;
}

function openai(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set.");
  }
  openaiClient ??= new OpenAI();
  return openaiClient;
}

export interface Call {
  task: Task;
  system: string;
  user: string;
  maxTokens?: number;
}

/** Schema-constrained JSON. Returns null when the model produced nothing usable. */
export async function generateObject<S extends z.ZodType>(
  schema: S,
  { task, system, user, maxTokens = 8000 }: Call,
  schemaName = "result",
): Promise<z.infer<S> | null> {
  const provider = activeProvider();
  const model = modelFor(task, provider);
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

  const res = await openai().chat.completions.parse({
    model,
    reasoning_effort: effort,
    max_completion_tokens: maxTokens,
    response_format: zodResponseFormat(schema, schemaName),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  // The SDK's inferred parse type is structurally identical but not assignable
  // to z.infer<S> across the two zod re-exports.
  return (res.choices[0]?.message.parsed as z.infer<S> | undefined) ?? null;
}

/** Plain-text stream, used for drafting. */
export function streamText({
  task,
  system,
  user,
  maxTokens = 16000,
}: Call): ReadableStream<Uint8Array> {
  const provider = activeProvider();
  const model = modelFor(task, provider);
  const effort = EFFORT[task];
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        if (provider === "anthropic") {
          const stream = anthropic().messages.stream({
            model,
            max_tokens: maxTokens,
            system,
            output_config: { effort },
            messages: [{ role: "user", content: user }],
          });
          stream.on("text", (delta) => controller.enqueue(encoder.encode(delta)));
          await stream.finalMessage();
        } else {
          const stream = await openai().chat.completions.create({
            model,
            reasoning_effort: effort,
            max_completion_tokens: maxTokens,
            stream: true,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          });
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) controller.enqueue(encoder.encode(delta));
          }
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

/** For the settings page. */
export function providerStatus(): {
  active: Provider | null;
  anthropic: boolean;
  openai: boolean;
  model: Record<Task, string> | null;
} {
  const hasA = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasO = Boolean(process.env.OPENAI_API_KEY);
  if (!hasA && !hasO) {
    return { active: null, anthropic: false, openai: false, model: null };
  }
  const active = activeProvider();
  return {
    active,
    anthropic: hasA,
    openai: hasO,
    model: {
      parse: modelFor("parse", active),
      rerank: modelFor("rerank", active),
      extract: modelFor("extract", active),
      write: modelFor("write", active),
    },
  };
}
