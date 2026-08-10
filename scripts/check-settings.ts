import { getSettings, saveSettings, resolveTask, sourceEnabled } from "../lib/settings";
import { TASKS, defaultModel, configuredProviders } from "../lib/ai/models";

async function main() {
  console.log("configured providers:", configuredProviders().join(", ") || "(none)");
  const before = await getSettings();
  console.log("defaults -> sources:", JSON.stringify(before.sources));

  for (const t of TASKS) {
    try {
      const r = await resolveTask(t);
      console.log(`  ${t.padEnd(8)} ${r.provider}/${r.model}`);
    } catch (e) {
      console.log(`  ${t.padEnd(8)} ${(e as Error).message}`);
    }
  }

  await saveSettings({
    ...before,
    taskProvider: { write: "openrouter" },
    taskModel: { write: "nvidia/nemotron-3-super-120b-a12b:free" },
    sources: { serper: true, hunter: false, exa: true },
    exaMaxPerSearch: 2,
  });
  const after = await getSettings();
  console.log("persisted sources:", JSON.stringify(after.sources), "exaCap", after.exaMaxPerSearch);
  console.log("hunter enabled (toggled off):", await sourceEnabled("hunter"));
  console.log("serper enabled:", await sourceEnabled("serper"));
  console.log("exa enabled (no key):", await sourceEnabled("exa"));
  console.log("openrouter default write model:", defaultModel("write", "openrouter"));

  await saveSettings(before);
  console.log("restored: ok");
}
main().catch((e) => { console.error(e); process.exit(1); });
