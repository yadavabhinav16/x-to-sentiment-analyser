import { NextRequest, NextResponse } from "next/server";
import { getDraftForUser, updateDraft } from "@/modules/drafts/service";
import { requireUser, unauthorized } from "@/lib/require-user";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await requireUser();
  if (!user) return unauthorized();
  const draft = getDraftForUser(params.id, user.id);
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  const body = (await req.json()) as { editedText?: string; status?: "suggested" | "approved" | "rejected" };
  const updated = updateDraft(params.id, body);
  return NextResponse.json({ ok: true, draft: updated });
}