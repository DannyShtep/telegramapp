import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * В режиме local preview (npm run dev / v0 Preview) переменные окружения NEXT_PUBLIC_SUPABASE_URL
 * и NEXT_PUBLIC_SUPABASE_ANON_KEY обычно отсутствуют.  Чтобы не «падать» на клиент-сайде,
 * делаем эти переменные «опциональными»: если их нет — возвращаем `null` вместо ошибки.
 * На production-деплое (Vercel) они ОБЯЗАТЕЛЬНЫ. Для этого проверяем `process.env.VERCEL_ENV`.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

/** Кэшированные клиенты */
let _browserClient: SupabaseClient | null = null
let _serverClient: SupabaseClient | null = null

/**
 * Клиент для браузера.
 * – На production (VERCEL_ENV = "production" | "preview" | "development") переменные ОБЯЗАТЕЛЬНЫ.
 * – В локальном превью (v0 Preview / `next dev`) возвращаем `null`, чтобы приложение продолжило работать без Supabase.
 */
export const createClientComponentClient = () => {
  // Если переменные отсутствуют - в локальном превью вернём null
  if (!supabaseUrl || !supabaseAnonKey) {
    if (process.env.VERCEL_ENV) {
      // На Vercel переменные должны быть настроены
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY for Supabase client. Please set them in Project → Settings → Environment Variables.",
      )
    }
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
