/** True when running on a dev machine (not a serverless deploy). */
export const isLocal =
  process.env.VERCEL !== "1" && process.env.NODE_ENV !== "production";
