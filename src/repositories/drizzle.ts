import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  drafts,
  generationJobs,
  idempotencyKeys,
  tweets,
  users,
  voiceProfiles,
  type Draft,
  type GenerationJob,
  type IdempotencyRow,
  type Tweet,
  type User,
  type VoiceProfile,
} from "@/db/schema";
import type {
  DraftRepository,
  GenerationJobRepository,
  IdempotencyRepository,
  TweetRepository,
  UserRepository,
  VoiceProfileRepository,
} from "./interfaces";

/**
 * Drizzle implementations of the repository interfaces. These are the ONLY
 * modules that touch the schema directly; services depend on the interfaces.
 */

export class DrizzleUserRepository implements UserRepository {
  async findByEmail(email: string): Promise<User | undefined> {
    const clean = email.trim().toLowerCase();
    // Uses the functional lower(email) index from migration 2026-09-11-003.
    const rows = await getDb()
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${clean}`)
      .limit(1);
    return rows[0];
  }

  async findById(id: string): Promise<User | undefined> {
    const rows = await getDb().select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0];
  }

  async insert(row: Omit<User, "createdAt"> & { createdAt?: Date }): Promise<User> {
    const full: User = { createdAt: new Date(), ...row } as User;
    await getDb().insert(users).values(full);
    return full;
  }
}

export class DrizzleVoiceProfileRepository implements VoiceProfileRepository {
  async findByHandle(handle: string, userId?: string): Promise<VoiceProfile | undefined> {
    const clean = handle.replace(/^@/, "").toLowerCase();
    // Uses voice_profiles_handle_idx. Case-insensitivity handled here because
    // the stored handle preserves its original casing.
    if (userId === undefined) {
      const rows = await getDb()
        .select()
        .from(voiceProfiles)
        .where(sql`lower(${voiceProfiles.handle}) = ${clean}`)
        .limit(2);
      return rows.find((p) => p.handle.toLowerCase() === clean);
    }
    const rows = await getDb()
      .select()
      .from(voiceProfiles)
      .where(and(sql`lower(${voiceProfiles.handle}) = ${clean}`, eq(voiceProfiles.userId, userId)))
      .limit(2);
    return rows.find((p) => p.handle.toLowerCase() === clean);
  }

  async findById(id: string, userId?: string): Promise<VoiceProfile | undefined> {
    const rows = await getDb().select().from(voiceProfiles).where(eq(voiceProfiles.id, id)).limit(1);
    const row = rows[0];
    if (!row) return undefined;
    if (userId !== undefined && row.userId !== userId) return undefined;
    return row;
  }

  async listByUser(userId: string): Promise<VoiceProfile[]> {
    return getDb()
      .select()
      .from(voiceProfiles)
      .where(eq(voiceProfiles.userId, userId))
      .orderBy(desc(voiceProfiles.createdAt));
  }

  async insert(profile: Omit<VoiceProfile, "createdAt"> & { createdAt?: Date }): Promise<void> {
    const full = { createdAt: new Date(), ...profile } as VoiceProfile;
    await getDb().insert(voiceProfiles).values(full);
  }

  async update(id: string, patch: Partial<VoiceProfile>): Promise<void> {
    await getDb().update(voiceProfiles).set(patch).where(eq(voiceProfiles.id, id));
  }
}

export class DrizzleTweetRepository implements TweetRepository {
  async listByProfile(profileId: string): Promise<Tweet[]> {
    return getDb()
      .select()
      .from(tweets)
      .where(eq(tweets.voiceProfileId, profileId))
      .orderBy(desc(tweets.likes));
  }

  async insertMany(rows: Tweet[]): Promise<void> {
    if (!rows.length) return;
    await getDb().insert(tweets).values(rows);
  }

  async deleteByProfile(profileId: string): Promise<void> {
    await getDb().delete(tweets).where(eq(tweets.voiceProfileId, profileId));
  }

  async countByUser(userId: string): Promise<number> {
    const rows = await getDb()
      .select({ count: sql<number>`count(*)` })
      .from(tweets)
      .innerJoin(voiceProfiles, eq(tweets.voiceProfileId, voiceProfiles.id))
      .where(eq(voiceProfiles.userId, userId));
    return rows[0]?.count ?? 0;
  }
}

export class DrizzleDraftRepository implements DraftRepository {
  async listByProfile(profileId: string): Promise<Draft[]> {
    return getDb()
      .select()
      .from(drafts)
      .where(eq(drafts.voiceProfileId, profileId))
      .orderBy(desc(drafts.createdAt));
  }

  async recentByProfile(
    profileId: string,
    limit: number
  ): Promise<Array<Pick<Draft, "text" | "styleMatch" | "moderationFlags" | "moderationLabel">>> {
    return getDb()
      .select({ text: drafts.text, styleMatch: drafts.styleMatch, moderationFlags: drafts.moderationFlags, moderationLabel: drafts.moderationLabel })
      .from(drafts)
      .where(eq(drafts.voiceProfileId, profileId))
      .orderBy(desc(drafts.createdAt))
      .limit(limit);
  }

  async findById(id: string): Promise<Draft | undefined> {
    const rows = await getDb().select().from(drafts).where(eq(drafts.id, id)).limit(1);
    return rows[0];
  }

  async insertMany(rows: Draft[]): Promise<void> {
    if (!rows.length) return;
    await getDb().insert(drafts).values(rows);
  }

  async update(id: string, patch: { editedText?: string; status?: "suggested" | "approved" | "rejected" }): Promise<void> {
    await getDb().update(drafts).set(patch).where(eq(drafts.id, id));
  }
}

export class DrizzleGenerationJobRepository implements GenerationJobRepository {
  async insert(job: GenerationJob): Promise<void> {
    await getDb().insert(generationJobs).values(job);
  }

  async update(id: string, patch: Partial<GenerationJob>): Promise<void> {
    await getDb().update(generationJobs).set(patch).where(eq(generationJobs.id, id));
  }

  async recentByUser(
    userId: string,
    limit: number
  ): Promise<Array<Pick<GenerationJob, "id" | "status" | "count" | "shadowVerdict" | "shadowValidator" | "createdAt">>> {
    return getDb()
      .select({
        id: generationJobs.id,
        status: generationJobs.status,
        count: generationJobs.count,
        shadowVerdict: generationJobs.shadowVerdict,
        shadowValidator: generationJobs.shadowValidator,
        createdAt: generationJobs.createdAt,
      })
      .from(generationJobs)
      .where(eq(generationJobs.userId, userId))
      .orderBy(desc(generationJobs.createdAt))
      .limit(limit);
  }
}

export class DrizzleIdempotencyRepository implements IdempotencyRepository {
  async find(scope: string, key: string): Promise<IdempotencyRow | undefined> {
    const rows = await getDb()
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)))
      .limit(1);
    return rows[0] as IdempotencyRow | undefined;
  }

  async claim(row: IdempotencyRow): Promise<Array<{ scope: string }>> {
    return getDb()
      .insert(idempotencyKeys)
      .values(row)
      .onConflictDoNothing({ target: [idempotencyKeys.scope, idempotencyKeys.key] })
      .returning({ scope: idempotencyKeys.scope });
  }

  async update(scope: string, key: string, patch: Partial<IdempotencyRow>): Promise<void> {
    await getDb()
      .update(idempotencyKeys)
      .set(patch)
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
  }

  async delete(scope: string, key: string): Promise<void> {
    await getDb()
      .delete(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
  }
}
