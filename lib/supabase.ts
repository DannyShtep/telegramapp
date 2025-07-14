import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * Берём переменные окружения; если их нет – оставляем пустую строку.
 * В режиме preview (Next.js) значений, как правило, нет.
 */
const supabaseUrl = "https://hiiqvftcuokmdtygyrxz.supabase.co"
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhpaXF2ZnRjdW9rbWR0eWd5cnh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzNDUzMjgsImV4cCI6MjA2NzkyMTMyOH0.xKyjR96D0nN8e6CS5Aa1pmaukgY5P7W3qypkCAWT1_4"
const supabaseServiceRoleKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhpaXF2ZnRjdW9rbWR0eWd5cnh6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjM0NTMyOCwiZXhwIjoyMDY3OTIxMzI4fQ.m_uzDLAbSGU1UPHAc89RNM1G9Q5dCO0F9drItfLT7ic"

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
