import { NextRequest, NextResponse } from "next/server";
import { getDraftForUser, updateDraft } from "@/modules/drafts/service";
import { requireUser, unauthorized } from "@/lib/require-user";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await requireUser();
  if (!user) return unauthorized();
  const rl = rateLimit(`draft-act:${user.id}`, 60, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded. Try again later." }, { status: 429 });
  }
  const draft = getDraftForUser(params.id, user.id);
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  const updated = updateDraft(params.id, { status: "rejected" });
  return NextResponse.json({ ok: true, draft: updated });
}