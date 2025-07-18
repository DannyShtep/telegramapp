import { createClient } from "@supabase/supabase-js"
import { createBrowserClient } from "@supabase/ssr"

// Server-side Supabase client
export function createServerComponentClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not defined for server component.")
  }
  return createClient(supabaseUrl, supabaseAnonKey)
}

// Client-side Supabase client (singleton pattern)
let supabaseBrowserClient: ReturnType<typeof createBrowserClient> | undefined

export function createClientComponentClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not defined for client component.")
  }
  if (!supabaseBrowserClient) {
    supabaseBrowserClient = createBrowserClient(supabaseUrl, supabaseAnonKey)
  }
  return supabaseBrowserClient
}
