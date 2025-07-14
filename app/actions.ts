/>

- Replace `guardSupabase\` so it never throws and add an \`isDemo\` flag we can reuse:

``\`ts
/** Returns Supabase client or \`null\` if env vars are missing. */
export function getSupabase() {
  const client = createServerComponentClient()
  return client && process.env.NEXT_PUBLIC_SUPABASE_URL ? client : null
}

/** True while we’re running locally (no env vars → demo mode). */
export const isDemo = !process.env.NEXT_PUBLIC_SUPABASE_URL
