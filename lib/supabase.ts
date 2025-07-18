import { createClient } from "@supabase/supabase-js"
import { createBrowserClient } from "@supabase/ssr"

// Ensure these are defined in your environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing Supabase environment variables.")
  // Depending on your application's needs, you might want to throw an error
  // or handle this more gracefully (e.g., disable Supabase features).
}

// Server-side Supabase client
export function createServerComponentClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase URL or Anon Key is not defined for server component.")
  }
  return createClient(supabaseUrl, supabaseAnonKey)
}

// Client-side Supabase client (singleton pattern)
let supabaseBrowserClient: ReturnType<typeof createBrowserClient> | undefined

export function createClientComponentClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase URL or Anon Key is not defined for client component.")
  }
  if (!supabaseBrowserClient) {
    supabaseBrowserClient = createBrowserClient(supabaseUrl, supabaseAnonKey)
  }
  return supabaseBrowserClient
}
