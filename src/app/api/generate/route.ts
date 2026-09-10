import { NextRequest, NextResponse } from "next/server";
import { getProfileByHandle, getCorpus } from "@/modules/drafts/service";
import { runGenerationForProfile } from "@/modules/voice/generation-orchestrator";
import { MissingKeyError } from "@/modules/voice/generation-service";
import { styleProfileSchema } from "@/modules/analysis/style-profile";
import { logger } from "@/lib/logger";
import { requireUser, unauthorized } from "@/lib/require-user";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const rl = rateLimit(`generate:${user.id}`, 20, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit: max 20 generations per hour. Try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  try {
    const body = (await req.json()) as { handle?: string; count?: number; topic?: string };
    const count = Math.min(8, Math.max(1, body.count ?? 5));
    const profileRow = body.handle
      ? await getProfileByHandle(body.handle, user.id) // scoped to this user
      : undefined;
    if (!profileRow) {
      return NextResponse.json({ error: "Profile not found — create one first." }, { status: 404 });
    }
    const profile = styleProfileSchema.parse(
      JSON.parse(typeof profileRow.styleProfile === "string" ? profileRow.styleProfile : JSON.stringify(profileRow.styleProfile))
    );
    const corpusRows = await getCorpus(profileRow.id);
    const corpus = corpusRows.map((t) => ({
      id: t.id,
      text: t.text,
      createdAt: t.postedAt ?? new Date().toISOString(),
      likeCount: t.likes,
      retweetCount: t.rts,
      replyCount: t.replies,
      quoteCount: 0,
      impressionCount: t.impressions,
    }));

    try {
      const result = await runGenerationForProfile(
        user.id,
        profileRow.id,
        profile,
        corpus,
        count,
        body.topic
      );
      return NextResponse.json({
        ok: true,
        jobId: result.jobId,
        count: result.drafts.length,
        blockedCount: result.blockedCount,
        shadowValidation: result.shadowValidation,
        drafts: result.drafts,
      });
    } catch (err) {
      if (err instanceof MissingKeyError) throw err;
      throw err;
    }
  } catch (err) {
    logger.error("Generation failed", { error: String(err), userId: user.id });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
