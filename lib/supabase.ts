import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * Берём переменные окружения. Если их нет, выбрасываем ошибку,
 * так как в продакшене они должны быть настроены.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

/** Кэшированные клиенты */
let _browserClient: SupabaseClient | null = null
let _serverClient: SupabaseClient | null = null

/**
 * Клиент для браузера (используется в компоненте).
 * Если переменные окружения не заданы – выбрасываем ошибку.
 */
export const createClientComponentClient = () => {
  if (!_browserClient) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY for Supabase client. Please check your Vercel environment variables.",
      )
    }
    _browserClient = createClient(supabaseUrl, supabaseAnonKey)
  }
  return _browserClient
}

/**
 * Клиент для серверных Action'ов.
 * Если переменные окружения не заданы – выбрасываем ошибку.
 */
export const createServerComponentClient = () => {
  if (!_serverClient) {
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for Supabase server client. Please check your Vercel environment variables.",
      )
    }
    _serverClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    })
  }
  return _serverClient
}
