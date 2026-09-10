import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createUser, EMAIL_RE } from "@/modules/auth/users";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().regex(EMAIL_RE, "Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  name: z.string().max(80).optional(),
});

export async function POST(req: NextRequest) {
  const rl = rateLimit(`register:${clientIp(req)}`, 5, 15 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }
  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input." },
        { status: 400 }
      );
    }
    const { email, password, name } = parsed.data;
    const user = await createUser(email, password, name);
    return NextResponse.json({ ok: true, user: { id: user.id, email: user.email } }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}