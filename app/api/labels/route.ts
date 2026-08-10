import {
  createLabel,
  deleteLabel,
  listLabels,
  renameLabel,
} from "@/lib/threads/store";
import type { LabelKind } from "@/lib/threads/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true, labels: await listLabels() });
}

/** Create, rename and delete in one handler — the client only ever needs one. */
export async function POST(req: Request) {
  const { action, id, kind, name, color } = (await req.json()) as {
    action?: "create" | "rename" | "delete";
    id?: string;
    kind?: LabelKind;
    name?: string;
    color?: string;
  };

  try {
    if (action === "create") {
      const label = await createLabel({
        kind: kind === "tag" ? "tag" : "folder",
        name: name ?? "",
        color,
      });
      return Response.json({ ok: true, label });
    }
    if (action === "rename") {
      if (!id) throw new Error("An id is required.");
      await renameLabel(id, name ?? "", color);
      return Response.json({ ok: true });
    }
    if (action === "delete") {
      if (!id) throw new Error("An id is required.");
      await deleteLabel(id);
      return Response.json({ ok: true });
    }
    throw new Error("Unknown action.");
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
