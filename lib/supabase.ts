import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/** Кэшированные клиенты */
let _browserClient: SupabaseClient | null = null
let _serverClient: SupabaseClient | null = null

/**
 * Клиент для браузера.
 * – На production (Vercel) переменные NEXT_PUBLIC_SUPABASE_URL и NEXT_PUBLIC_SUPABASE_ANON_KEY ОБЯЗАТЕЛЬНЫ.
 * – В локальном превью (v0 Preview / `next dev`) возвращаем `null`, чтобы приложение продолжило работать без Supabase.
 */
export const createClientComponentClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    // В локальном превью или dev-режиме, если переменные не заданы, просто логируем предупреждение.
    // На Vercel, если они не заданы, сборка упадет, так как они обязательны для продакшена.
    console.warn(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY for client-side Supabase client. Returning null.",
    )
    return null
  }

  if (!_browserClient) {
    _browserClient = createClient(supabaseUrl, supabaseAnonKey)
  }
  return _browserClient
}

/**
 * Клиент для серверных Action'ов.
 * Если переменные окружения не заданы – выбрасываем ошибку.
 */
export const createServerComponentClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for Supabase server client. Please check your Vercel environment variables.",
    )
  }

  if (!_serverClient) {
    _serverClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    })
  }
  return _serverClient
}
