import * as z from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic } from "./client";
import { MODELS } from "./models";
import { cached, DAY } from "../cache";

const Schema = z.object({
  isCorrectPerson: z
    .boolean()
    .describe("True only if these pages are about the named person."),
  email: z
    .string()
    .nullable()
    .describe(
      "Their personal address, fully de-obfuscated into normal form. Null if not present.",
    ),
  emailEvidence: z
    .string()
    .nullable()
    .describe("The literal text the address came from, before de-obfuscation."),
  title: z.string().nullable().describe("e.g. 'Associate Professor'."),
  dept: z.string().nullable(),
  lab: z.string().nullable().describe("Research group or lab name."),
  researchAreas: z.array(z.string()).describe("3-6 short phrases."),
  homepage: z.string().nullable().describe("Their main personal/faculty page."),
  location: z.string().nullable().describe("City and country if stated."),
  notes: z
    .array(z.string())
    .describe(
      "2-4 specific, factual hooks a cold email could reference — a named project, a recent award, a stated interest. No flattery, no generalities.",
    ),
});

export type ExtractedProfile = z.infer<typeof Schema>;

const SYSTEM = `You read scraped web pages about one named person and extract a factual profile.

EMAIL RULES — these matter most:
- Pages hide addresses. De-obfuscate them: "tim.barfoot [at] utoronto.ca" is tim.barfoot@utoronto.ca. Also handle (at)/(dot), {at}, "name at domain dot edu", spaced-out characters, and HTML entities.
- Return the address of THE NAMED PERSON only. A lab manager, department admin, webmaster, co-author, or generic info@/contact@ address is NOT their address — return null instead.
- NEVER return a template placeholder. Addresses like x@, email@, name@, firstname.lastname@, john.doe@, user@, or anything @example.com are documentation stubs, not real. Return null.
- Do not construct or guess an address from a name and a domain. Only report one that literally appears on the page. Guessing is handled elsewhere.
- If you are not confident the address belongs to this person, return null. A missing address is much better than a wrong one.

Set isCorrectPerson to false if the pages are about a different person with a similar name, and leave the other fields empty.

For notes, prefer concrete specifics ("leads the Autonomous Space Robotics Lab", "recent work on lidar-only navigation in darkness") over vague praise. These are the hooks that make an email read as genuinely researched.`;

export interface PageInput {
  url: string;
  title: string;
  text: string;
}

export async function extractProfile(
  name: string,
  org: string | null,
  pages: PageInput[],
): Promise<ExtractedProfile | null> {
  if (pages.length === 0) return null;

  // Keep the payload bounded — contact details live near the top of a page,
  // and this is the step that dominates token spend.
  const corpus = pages
    .map(
      (p) =>
        `--- SOURCE: ${p.url}\nTITLE: ${p.title}\n${p.text.slice(0, 12_000)}`,
    )
    .join("\n\n")
    .slice(0, 45_000);

  const cacheKey = `extract:${MODELS.EXTRACT}:${name}:${pages.map((p) => p.url).join("|")}`;

  return cached<ExtractedProfile | null>(cacheKey, 14 * DAY, async () => {
    const res = await anthropic().messages.parse({
      model: MODELS.EXTRACT,
      max_tokens: 8000,
      system: SYSTEM,
      output_config: { effort: "low", format: zodOutputFormat(Schema) },
      messages: [
        {
          role: "user",
          content: `Person: ${name}${org ? `\nExpected affiliation: ${org}` : ""}\n\n${corpus}`,
        },
      ],
    });
    return res.parsed_output ?? null;
  });
}
