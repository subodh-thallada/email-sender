import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
} from "../lib/templates";
import {
  fillFor,
  fillTemplate,
  senderVars,
  templateVars,
  unfilledTokens,
} from "../lib/template-fill";
import { buildPrompt, systemFor } from "../lib/ai/write-email";
import { getProfile } from "../lib/profile";

async function main() {
  const before = await listTemplates();
  console.log("existing templates:", before.length);

  const id = await createTemplate({
    name: "  Check script  ",
    subject: "Question about {{dept}} at {{org}}",
    body: "Hi {{first_name}},\n\nSaw your work at {{org}}. {{unknown_thing}}\n\n{{signature}}",
    notes: "Keep it to three sentences.",
  });
  const saved = await getTemplate(id);
  console.log("created:", JSON.stringify(saved?.name), "(trimmed)");

  const vars = templateVars(
    {
      name: "Dr. Jane Q. Smith",
      title: "Associate Professor",
      org: "University of Toronto",
      dept: "", // Missing on purpose: the placeholder should leave no gap.
      email: "jane@utoronto.ca",
    },
    { my_name: "Sam", my_headline: "", my_goal: "", signature: "— Sam" },
  );
  console.log("first/last:", vars.first_name, "/", vars.last_name);

  const filled = fillFor(saved!, vars);
  console.log("subject:", JSON.stringify(filled.subject));
  console.log("body:\n" + filled.body);
  console.log("left standing:", unfilledTokens(filled.body).join(", ") || "(none)");
  console.log(
    "no double spaces:",
    !/[^\S\n]{2}/.test(filled.subject + filled.body),
  );
  console.log("spacing variant fills:", fillTemplate("{{ first_name }}", vars));

  await updateTemplate(id, {
    name: "Check script v2",
    subject: filled.subject,
    body: "Short body.",
    notes: "",
  });
  console.log("updated name:", (await getTemplate(id))?.name);

  // The prompt the writer model sees when this template is selected.
  const profile = await getProfile();
  const prompt = buildPrompt(
    profile,
    { name: "Jane Smith", title: "Associate Professor", org: "U of T" },
    null,
    { name: "Check script v2", subject: filled.subject, body: "Short body.", notes: "" },
  );
  console.log("prompt carries template:", prompt.includes("TEMPLATE —"));
  console.log(
    "system rule added:",
    systemFor(profile, {
      name: "x",
      subject: "",
      body: "",
      notes: "",
    }).includes("The sender has chosen a template"),
  );
  console.log("system rule absent without one:", !systemFor(profile).includes("chosen a template"));

  await deleteTemplate(id);
  console.log(
    "deleted:",
    (await getTemplate(id)) === null,
    "| back to",
    (await listTemplates()).length,
  );
  console.log("sender vars from profile:", JSON.stringify(senderVars(profile)));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
