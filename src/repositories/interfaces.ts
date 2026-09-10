import type { Draft, GenerationJob, IdempotencyRow, Tweet, User, VoiceProfile } from "@/db/schema";
import type { SessionUser } from "@/lib/require-user";

/**
 * Repository interfaces — the only DB surface services may depend on.
 * Implementations live in ./drizzle and receive their Db handle by injection,
 * so tests can supply an in-memory implementation instead of a database.
 */

export interface UserRepository {
  findByEmail(email: string): Promise<User | undefined>;
  findById(id: string): Promise<User | undefined>;
  insert(user: Omit<User, "createdAt"> & { createdAt?: Date }): Promise<User>;
}

export interface VoiceProfileRepository {
  /** Case-insensitive lookup scoped to a user (or all users when userId is undefined). */
  findByHandle(handle: string, userId?: string): Promise<VoiceProfile | undefined>;
  findById(id: string, userId?: string): Promise<VoiceProfile | undefined>;
  listByUser(userId: string): Promise<VoiceProfile[]>;
  insert(profile: Omit<VoiceProfile, "createdAt"> & { createdAt?: Date }): Promise<void>;
  update(id: string, patch: Partial<VoiceProfile>): Promise<void>;
}

export interface TweetRepository {
  listByProfile(profileId: string): Promise<Tweet[]>;
  insertMany(rows: Array<Omit<Tweet, never>>): Promise<void>;
  deleteByProfile(profileId: string): Promise<void>;
  countByUser(userId: string): Promise<number>;
}

export interface DraftRepository {
  listByProfile(profileId: string): Promise<Draft[]>;
  /** Most recent drafts for a profile, trimmed projection for quality reporting. */
  recentByProfile(profileId: string, limit: number): Promise<Array<Pick<Draft, "text" | "styleMatch" | "moderationFlags" | "moderationLabel">>>;
  findById(id: string): Promise<Draft | undefined>;
  /** Nullable/defaulted columns (editedText, flags, label) may be omitted. */
  insertMany(rows: Array<Omit<Draft, "editedText" | "moderationFlags" | "moderationLabel"> & Partial<Pick<Draft, "editedText" | "moderationFlags" | "moderationLabel">>>): Promise<void>;
  update(id: string, patch: { editedText?: string; status?: "suggested" | "approved" | "rejected" }): Promise<void>;
}

export interface GenerationJobRepository {
  insert(job: GenerationJob): Promise<void>;
  update(id: string, patch: Partial<GenerationJob>): Promise<void>;
  recentByUser(userId: string, limit: number): Promise<Array<Pick<GenerationJob, "id" | "status" | "count" | "shadowVerdict" | "shadowValidator" | "createdAt">>>;
}

export interface IdempotencyRepository {
  find(scope: string, key: string): Promise<IdempotencyRow | undefined>;
  /** Insert-if-absent; returns the inserted rows (empty when the key was already claimed). */
  claim(row: IdempotencyRow): Promise<Array<{ scope: string }>>;
  update(scope: string, key: string, patch: Partial<IdempotencyRow>): Promise<void>;
  delete(scope: string, key: string): Promise<void>;
}

/** Session-shaped projection; keeps the auth layer free of the users table. */
export type UserLookup = (id: string) => Promise<SessionUser | null>;
