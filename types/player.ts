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
  lastActiveAt?: string // Optional, for client-side representation
}

// Supabase representation (snake_case)
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
  last_active_at: string
}

export interface Room {
  id: string
  status: "waiting" | "single_player" | "countdown" | "spinning" | "finished"
  countdown: number
  winner_telegram_id: number | null
  total_gifts: number
  total_ton: number
  created_at: string
}
