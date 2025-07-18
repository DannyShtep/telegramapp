"use server"

import { createServerComponentClient } from "@/lib/supabase"
import type { Player, SupabasePlayer } from "@/types/player"

/** Returns Supabase client. Throws an error if env vars are missing. */
export async function getSupabase() {
  const client = createServerComponentClient()
  return client
}

/**
 * Функция для преобразования объекта SupabasePlayer (snake_case) в Player (camelCase).
 */
function mapSupabasePlayerToClientPlayer(supabasePlayer: SupabasePlayer): Player {
  return {
    id: supabasePlayer.id,
    telegramId: supabasePlayer.telegram_id,
    username: supabasePlayer.username || null,
    displayName:
      supabasePlayer.display_name ||
      (supabasePlayer.username
        ? `@${supabasePlayer.username}`
        : supabasePlayer.telegram_id
          ? `User ${supabasePlayer.telegram_id}`
          : "Unknown User"),
    avatar: supabasePlayer.avatar,
    gifts: supabasePlayer.gifts,
    tonValue: supabasePlayer.ton_value,
    color: supabasePlayer.color,
    percentage: supabasePlayer.percentage,
    isParticipant: supabasePlayer.is_participant,
  }
}

// Функция для получения или создания комнаты
export async function getOrCreateRoom(roomId = "default-room-id") {
  try {
    const supabase = await getSupabase()

    const { data: room, error: fetchError } = await supabase.from("rooms").select("*").eq("id", roomId).single()

    if (fetchError && fetchError.code === "PGRST116") {
      // Комната не найдена, создаем новую
      const { data: newRoom, error: createError } = await supabase
        .from("rooms")
        .insert({
          id: roomId,
          status: "waiting",
          countdown: 20,
          total_gifts: 0,
          total_ton: 0,
          countdown_end_time: null,
          winner_telegram_id: null, // Убедимся, что winner_telegram_id тоже инициализирован
        })
        .select()
        .single()

      if (createError) {
        console.error("Error creating room:", createError)
        return { room: null, error: createError.message }
      }
      return { room: newRoom, error: null }
    } else if (fetchError) {
      console.error("Error fetching room:", fetchError)
      return { room: null, error: fetchError.message }
    }

    return { room, error: null }
  } catch (error: any) {
    console.error("Caught exception in getOrCreateRoom:", error.message)
    return { room: null, error: error.message }
  }
}

// Функция для обеспечения присутствия пользователя в списке онлайн
export async function ensureUserOnline(
  roomId: string,
  telegramId: number,
  telegramUsername: string | undefined,
  avatarUrl: string,
  displayName: string,
) {
  try {
    const supabase = await getSupabase()

    const { data: existingPlayer, error: fetchPlayerError } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", roomId)
      .eq("telegram_id", telegramId)
      .single()

    if (fetchPlayerError && fetchPlayerError.code !== "PGRST116") {
      console.error("Error fetching existing player in ensureUserOnline:", fetchPlayerError)
      return { success: false, error: fetchPlayerError.message }
    }

    if (existingPlayer) {
      const { error: updateError } = await supabase
        .from("players")
        .update({
          username: telegramUsername,
          display_name: displayName,
          avatar: avatarUrl,
          last_active_at: new Date().toISOString(), // Обновляем время активности
        })
        .eq("id", existingPlayer.id)

      if (updateError) {
        console.error("Error updating existing player in ensureUserOnline:", updateError)
        return { success: false, error: updateError.message }
      }
    } else {
      // Генерируем UUID для нового игрока
      const newPlayerId = crypto.randomUUID()
      const newPlayerData = {
        id: newPlayerId, // Используем сгенерированный UUID
        room_id: roomId,
        telegram_id: telegramId,
        username: telegramUsername,
        display_name: displayName,
        avatar: avatarUrl,
        gifts: 0,
        ton_value: 0,
        color: "#4b5563",
        percentage: 0,
        is_participant: false,
        last_active_at: new Date().toISOString(), // Устанавливаем время активности
      }

      const { error: insertError } = await supabase.from("players").insert(newPlayerData)

      if (insertError) {
        console.error("Error inserting new online player in ensureUserOnline:", insertError)
        return { success: false, error: insertError.message }
      }
    }
    return { success: true, error: null }
  } catch (error: any) {
    console.error("Caught exception in ensureUserOnline:", error.message)
    return { success: false, error: error.message }
  }
}

// Функция для получения всех игроков в комнате
export async function getPlayersInRoom(roomId: string) {
  try {
    const supabase = await getSupabase()

    const { data, error } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", roomId)
      .order("last_active_at", { ascending: false }) // Сортируем по последней активности

    if (error) {
      console.error("Error fetching players in getPlayersInRoom:", error)
      return { players: [], error: error.message }
    }

    const clientPlayers: Player[] = (data as SupabasePlayer[]).map(mapSupabasePlayerToClientPlayer)

    return { players: clientPlayers, error: null }
  } catch (error: any) {
    console.error("Caught exception in getPlayersInRoom:", error.message)
    return { players: [], error: error.message }
  }
}

// Функция для получения только участников игры (is_participant = true)
export async function getParticipants(roomId: string) {
  try {
    const supabase = await getSupabase()

    const { data, error } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", roomId)
      .eq("is_participant", true)
      .order("created_at", { ascending: true })

    if (error) {
      console.error("Error fetching participants in getParticipants:", error)
      return { participants: [], error: error.message }
    }

    const clientParticipants: Player[] = (data as SupabasePlayer[]).map(mapSupabasePlayerToClientPlayer)

    return { participants: clientParticipants, error: null }
  } catch (error: any) {
    console.error("Caught exception in getParticipants:", error.message)
    return { participants: [], error: error.message }
  }
}

// --- Ниже заглушки для функций, которые ранее использовали RPC ---
// Вы можете реализовать их заново, когда будете готовы.

export async function addPlayerToRoom(roomId: string, playerData: Player) {
  console.log("addPlayerToRoom (stub): This function is currently a placeholder.")
  console.log("Room ID:", roomId, "Player Data:", playerData)
  return { room: null, error: "Function not implemented in this version." }
}

export async function updateRoomState(
  roomId: string,
  newState: {
    status?: "waiting" | "single_player" | "countdown" | "spinning" | "finished"
    countdown?: number
    winner_telegram_id?: number | null
    total_gifts?: number
    total_ton?: number
    countdown_end_time?: string | null
  },
) {
  console.log("updateRoomState (stub): This function is currently a placeholder.")
  console.log("Room ID:", roomId, "New State:", newState)
  return { room: null, error: "Function not implemented in this version." }
}

export async function resetRoom(roomId: string) {
  console.log("resetRoom (stub): This function is currently a placeholder.")
  console.log("Room ID:", roomId)
  return { success: false, error: "Function not implemented in this version." }
}

export async function determineWinnerAndSpin(roomId: string) {
  console.log("determineWinnerAndSpin (stub): This function is currently a placeholder.")
  console.log("Room ID:", roomId)
  return { success: false, error: "Function not implemented in this version." }
}
