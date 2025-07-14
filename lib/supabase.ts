import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * Берём переменные окружения; если их нет – оставляем пустую строку.
 * В режиме preview (Next.js) значений, как правило, нет.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""

/** Кэшированные клиенты */
let _browserClient: SupabaseClient | null = null
let _serverClient: SupabaseClient | null = null

/**
 * Клиент для браузера (используется в компоненте).
 * Если переменные окружения не заданы – возвращаем null,
 * чтобы приложение могло работать в офлайн-режиме без краша.
 */
export const createClientComponentClient = () => {
  if (!_browserClient) {
    if (!supabaseUrl || !supabaseAnonKey) {
      if (typeof window !== "undefined") {
        console.warn("Supabase env vars are not configured. Running in demo mode with no realtime backend.")
      }
      return null
    }
    _browserClient = createClient(supabaseUrl, supabaseAnonKey)
  }
  return _browserClient
}

/**
 * Клиент для серверных Action'ов.
 * Возвращаем null, если переменных нет (на preview это допустимо).
 */
export const createServerComponentClient = () => {
  if (!_serverClient) {
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      console.warn("Supabase env vars for server are not configured. Server actions will be no-ops.")
      return null as unknown as SupabaseClient
    }
    _serverClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    })
  }
  return _serverClient
}
