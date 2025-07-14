// types/player.ts

/**
 * Интерфейс для данных игрока, как они хранятся в базе данных Supabase (snake_case).
 */
export interface SupabasePlayer {
  id: string
  room_id: string
  telegram_id: number
  username: string | null
  display_name: string | null
  avatar: string | null
  gifts: number
  ton_value: number
  color: string
  percentage: number
  is_participant: boolean
  created_at: string
}

/**
 * Интерфейс для данных игрока, как они используются в клиентском React-коде (camelCase).
 */
export interface Player {
  id: string
  telegramId: number
  username: string | null
  displayName: string
  avatar: string | null
  gifts: number
  tonValue: number
  color: string
  percentage: number
  isParticipant: boolean
}
