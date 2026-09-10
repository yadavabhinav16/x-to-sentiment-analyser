import { NextRequest, NextResponse } from "next/server";
import { MockTweetSource } from "@/modules/ingestion/mock-tweet-source";
import { XApiTweetSource } from "@/modules/ingestion/x-api-tweet-source";
import { createProfileFromHandle } from "@/modules/profiles/create-service";
import { logger } from "@/lib/logger";
import { requireUser, unauthorized } from "@/lib/require-user";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const rl = rateLimit(`profiles:create:${user.id}`, 10, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit: max 10 profiles per hour. Try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  try {
    const body = (await req.json()) as {
      handle?: string;
      limit?: number;
      mode?: "test" | "realtime";
    };
    const handle = (body.handle ?? "").replace(/^@/, "").trim();
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
      return NextResponse.json(
        { error: "Invalid handle: must be 1-15 letters, digits, or underscores." },
        { status: 400 }
      );
    }

    // Mode resolution:
    //  - mode="test"  → fixture-backed MockTweetSource (zero X API spend)
    //  - mode="realtime" → live XApiTweetSource using BEARER_TOKEN from env
    //  - mode unset   → env-driven default (USE_MOCK_X / BEARER_TOKEN)
    let source;
    if (body.mode === "test") {
      source = new MockTweetSource();
    } else if (body.mode === "realtime") {
      const bearerToken = process.env.BEARER_TOKEN;
      if (!bearerToken) {
        return NextResponse.json(
          { error: "BEARER_TOKEN is not configured — cannot run real-time mode." },
          { status: 503 }
        );
      }
      source = new XApiTweetSource(bearerToken);
    } else {
      if (process.env.USE_MOCK_X === "true") {
        source = new MockTweetSource();
      } else {
        return NextResponse.json(
          { error: "No tweet source available — set mode='test' or configure X API." },
          { status: 400 }
        );
      }
    }

    const { profileId, sampleCount } = await createProfileFromHandle(
      handle,
      source,
      Math.min(100, body.limit ?? 100),
      user.id
    );
    return NextResponse.json({
      ok: true,
      profileId,
      handle,
      sampleCount,
      mode: body.mode ?? "default",
      thinCorpus: sampleCount < 20,
    });
  } catch (err) {
    logger.error("Profile creation failed", { error: String(err), userId: user.id });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// clientIp retained for future anonymous endpoints.
void clientIp;