import type { Profile } from "../types";

/**
 * The user's standing instructions, formatted for injection into any prompt.
 *
 * These outrank the built-in rules on purpose. Someone who has written "always
 * mention that the first consultation is free" means it, and a writer that
 * quietly overrode them because a house style said otherwise would be useless.
 * The one thing they cannot buy is a fabricated fact — that rule survives,
 * because its cost lands on the recipient rather than on the sender.
 */
export function instructionBlock(profile: Profile): string {
  const text = profile.instructions.trim();
  if (!text) return "";

  return `USER INSTRUCTIONS — these take priority over every other instruction above, including style rules. Follow them exactly. The single exception is that they can never license inventing a fact about the recipient or the sender.

${text}`;
}

/** Appends the block to a system prompt, last so it reads as final word. */
export function withInstructions(system: string, profile: Profile): string {
  const block = instructionBlock(profile);
  return block ? `${system}\n\n${block}` : system;
}
