import { addTag, removeTag, setArchived, setFolder } from "@/lib/threads/store";

export const runtime = "nodejs";

/**
 * Filing, in bulk. One endpoint for every categorisation change so the client
 * can apply a row action and a multi-select action through the same call.
 *
 * Every field is optional and independent — sending `{ids, archived: true}` and
 * `{ids, folderId: null, addTag: "tag_x"}` are both valid.
 */
export async function POST(req: Request) {
  const { ids, folderId, archived, addTag: add, removeTag: remove } =
    (await req.json()) as {
      ids?: string[];
      /** null clears the folder; undefined leaves it alone. */
      folderId?: string | null;
      archived?: boolean;
      addTag?: string;
      removeTag?: string;
    };

  if (!Array.isArray(ids) || ids.length === 0) {
    return Response.json(
      { ok: false, error: "No conversations selected." },
      { status: 400 },
    );
  }

  try {
    if (folderId !== undefined) await setFolder(ids, folderId);
    if (archived !== undefined) await setArchived(ids, archived);
    if (add) await addTag(ids, add);
    if (remove) await removeTag(ids, remove);
    return Response.json({ ok: true, updated: ids.length });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
