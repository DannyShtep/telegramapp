import { createClient } from "@supabase/supabase-js"

// Убедитесь, что эти переменные окружения установлены в .env.local и Vercel
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY! // Только для серверных операций

// Клиент для использования на стороне клиента (браузер)
export const createClientComponentClient = () => createClient(supabaseUrl, supabaseAnonKey)

// Клиент для использования на стороне сервера (Server Actions, API Routes)
export const createServerComponentClient = () =>
  createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false, // Не сохраняем сессию на сервере
    },
  })
