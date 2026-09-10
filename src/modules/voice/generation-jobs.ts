import { randomUUID } from "crypto";
import { generationJobRepository } from "@/repositories";
import type { GenerationJob } from "@/db/schema";

/**
 * Generation job persistence service. Encapsulates job lifecycle state
 * changes (pending → running → done/failed) behind the repository layer.
 * Route handlers and orchestration code call these helpers instead of
 * touching the database directly.
 */

export function createJobId(): string {
  return randomUUID();
}

/** Record a job that failed before it could run (e.g. missing API key). */
export async function recordFailedJob(
  userId: string,
  voiceProfileId: string,
  count: number,
  error: string
): Promise<string> {
  const jobId = randomUUID();
  await generationJobRepository.insert({
    id: jobId,
    userId: userId ?? null,
    voiceProfileId,
    status: "failed",
    error,
    count,
    shadowVerdict: null,
    shadowValidator: null,
    createdAt: new Date(),
  });
  return jobId;
}

/** Start a new generation job in the "running" state; returns the job id. */
export async function startGenerationJob(
  userId: string,
  voiceProfileId: string,
  count: number
): Promise<string> {
  const jobId = randomUUID();
  await generationJobRepository.insert({
    id: jobId,
    userId,
    voiceProfileId,
    status: "running",
    error: null,
    count,
    shadowVerdict: null,
    shadowValidator: null,
    createdAt: new Date(),
  });
  return jobId;
}

/** Mark a job as done, recording shadow-validation results. */
export async function completeJob(
  jobId: string,
  shadow: { verdict: string; validator: string | null }
): Promise<void> {
  await generationJobRepository.update(jobId, {
    status: "done",
    shadowVerdict: shadow.verdict as "yes" | "no" | "unknown",
    shadowValidator: shadow.validator,
  });
}

/** Mark a job as failed with an error message. */
export async function failJob(jobId: string, error: string): Promise<void> {
  await generationJobRepository.update(jobId, { status: "failed", error });
}
