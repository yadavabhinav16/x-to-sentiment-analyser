import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDraftForUser, updateDraft } from "@/modules/drafts/service";
import { requireUser, unauthorized } from "@/lib/require-user";

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    editedText: z.string().min(1).max(500).optional(),
    status: z.enum(["suggested", "approved", "rejected"]).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "No updatable fields provided." })
  .refine((b) => !("id" in b) && !("voiceProfileId" in b) && !("generationId" in b), {
    message: "Immutable fields cannot be modified.",
  });

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await requireUser();
  if (!user) return unauthorized();
  const draft = await getDraftForUser(params.id, user.id);
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }
  const updated = await updateDraft(params.id, parsed.data);
  return NextResponse.json({ ok: true, draft: updated });
}