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
  last_active_at: string
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
  lastActiveAt?: string // Добавляем опциональное поле для отслеживания активности
}

/**
 * Интерфейс для состояния игры
 */
export interface GameState {
  isSpinning: boolean
  winner: Player | null
  totalPot: number
  participantCount: number
}

/**
 * Утилитарные типы для валидации
 */
export type PlayerStatus = "online" | "offline" | "participating"
export type GamePhase = "waiting" | "countdown" | "spinning" | "finished"
