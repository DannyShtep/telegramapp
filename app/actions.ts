"use server"

import { revalidatePath } from "next/cache"
import { createServerComponentClient } from "@/lib/supabase"

/** Returns Supabase client. Throws an error if env vars are missing. */
export async function getSupabase() {
  const client = createServerComponentClient()
  // createServerComponentClient уже выбрасывает ошибку, если переменные окружения не настроены.
  return client
}

interface PlayerData {
  id: string // Добавлено для явной передачи ID
  telegramId: number
  username: string
  displayName: string
  avatar: string
  gifts: number
  tonValue: number
  color: string
  percentage: number
  isParticipant: boolean
}

// Функция для получения или создания комнаты
export async function getOrCreateRoom(roomId = "default-room-id") {
  try {
    const supabase = await getSupabase()

    // Попытка получить комнату
    const { data: room, error: fetchError } = await supabase.from("rooms").select("*").eq("id", roomId).single()

    if (fetchError && fetchError.code === "PGRST116") {
      // Комната не найдена, создаем новую
      const { data: newRoom, error: createError } = await supabase
        .from("rooms")
        .insert({ id: roomId, status: "waiting", countdown: 20, total_gifts: 0, total_ton: 0 })
        .select()
        .single()

      if (createError) {
        console.error("getOrCreateRoom: Error creating room:", createError)
        return { room: null, error: createError.message }
      }
      return { room: newRoom, error: null }
    } else if (fetchError) {
      console.error("getOrCreateRoom: Error fetching room:", fetchError)
      return { room: null, error: fetchError.message }
    }

    return { room, error: null }
  } catch (error: any) {
    console.error("getOrCreateRoom: Caught exception:", error.message)
    return { room: null, error: error.message }
  }
}

// Новая функция для обеспечения присутствия пользователя в списке онлайн
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
      // PGRST116 означает "строки не найдены"
      console.error("ensureUserOnline: Error fetching existing player:", fetchPlayerError)
      return { success: false, error: fetchPlayerError.message }
    }

    if (existingPlayer) {
      // Если игрок уже есть, просто обновляем его данные (на случай смены ника/аватара)
      const { error: updateError } = await supabase
        .from("players")
        .update({
          username: telegramUsername,
          display_name: displayName,
          avatar: avatarUrl,
        })
        .eq("id", existingPlayer.id)

      if (updateError) {
        console.error("ensureUserOnline: Error updating existing player:", updateError)
        return { success: false, error: updateError.message }
      }
    } else {
      // Если игрока нет, добавляем его как наблюдателя (isParticipant: false)
      const newPlayerData = {
        id: `online_${telegramId}_${Date.now()}`, // Уникальный ID для онлайн-статуса
        room_id: roomId,
        telegram_id: telegramId,
        username: telegramUsername,
        display_name: displayName,
        avatar: avatarUrl,
        gifts: 0,
        ton_value: 0,
        color: "#4b5563", // Цвет по умолчанию для наблюдателей
        percentage: 0,
        is_participant: false, // Важно: это наблюдатель
      }

      const { error: insertError } = await supabase.from("players").insert(newPlayerData)

      if (insertError) {
        console.error("ensureUserOnline: Error inserting new online player:", insertError)
        return { success: false, error: insertError.message }
      }
    }

    revalidatePath("/")
    return { success: true, error: null }
  } catch (error: any) {
    console.error("ensureUserOnline: Caught exception:", error.message)
    return { success: false, error: error.message }
  }
}

// Функция для добавления игрока в комнату или обновления его статуса
export async function addPlayerToRoom(roomId: string, playerData: PlayerData) {
  try {
    const supabase = await getSupabase()

    // Проверяем, существует ли игрок уже в этой комнате
    const { data: existingPlayer, error: fetchPlayerError } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", roomId)
      .eq("telegram_id", playerData.telegramId)
      .single()

    if (fetchPlayerError && fetchPlayerError.code !== "PGRST116") {
      console.error("addPlayerToRoom: Error fetching existing player:", fetchPlayerError)
      return { player: null, error: fetchPlayerError.message }
    }

    let playerResult
    if (existingPlayer) {
      // Обновляем существующего игрока
      const { data, error } = await supabase
        .from("players")
        .update({
          gifts: playerData.gifts,
          ton_value: playerData.tonValue,
          color: playerData.color,
          percentage: playerData.percentage,
          is_participant: playerData.isParticipant,
          display_name: playerData.displayName, // Обновляем на случай изменения ника
          avatar: playerData.avatar, // Обновляем на случай изменения аватара
          username: playerData.username,
        })
        .eq("id", existingPlayer.id)
        .select()
        .single()
      playerResult = { data, error }
    } else {
      // Создаем нового игрока
      const { data, error } = await supabase
        .from("players")
        .insert({
          id: playerData.id, // <-- ЭТО ВАЖНО: передаем ID
          room_id: roomId,
          telegram_id: playerData.telegramId,
          username: playerData.username,
          display_name: playerData.displayName,
          avatar: playerData.avatar,
          gifts: playerData.gifts,
          ton_value: playerData.tonValue,
          color: playerData.color,
          percentage: playerData.percentage,
          is_participant: playerData.isParticipant,
        })
        .select()
        .single()
      playerResult = { data, error }
    }

    if (playerResult.error) {
      console.error("addPlayerToRoom: Error adding/updating player:", playerResult.error)
      return { player: null, error: playerResult.error.message }
    }

    revalidatePath("/") // Перевалидируем путь, чтобы обновить данные на клиенте
    return { player: playerResult.data, error: null }
  } catch (error: any) {
    console.error("addPlayerToRoom: Caught exception:", error.message)
    return { player: null, error: error.message }
  }
}

// Функция для обновления состояния комнаты
export async function updateRoomState(
  roomId: string,
  newState: {
    status?: "waiting" | "single_player" | "countdown" | "spinning" | "finished"
    countdown?: number
    winner_telegram_id?: number | null
    total_gifts?: number
    total_ton?: number
  },
) {
  try {
    const supabase = await getSupabase()

    const { data, error } = await supabase.from("rooms").update(newState).eq("id", roomId).select().single()

    if (error) {
      console.error("updateRoomState: Error updating room state:", error)
      return { room: null, error: error.message }
    }

    revalidatePath("/")
    return { room: data, error: null }
  } catch (error: any) {
    console.error("updateRoomState: Caught exception:", error.message)
    return { room: null, error: error.message }
  }
}

// Функция для сброса комнаты
export async function resetRoom(roomId: string) {
  try {
    const supabase = await getSupabase()

    // Удаляем всех игроков из комнаты
    const { error: deletePlayersError } = await supabase.from("players").delete().eq("room_id", roomId)

    if (deletePlayersError) {
      console.error("resetRoom: Error deleting players:", deletePlayersError)
      return { success: false, error: deletePlayersError.message }
    }

    // Сбрасываем состояние комнаты
    const { data: room, error: updateRoomError } = await supabase
      .from("rooms")
      .update({
        status: "waiting",
        countdown: 20,
        winner_telegram_id: null,
        total_gifts: 0,
        total_ton: 0.0,
      })
      .eq("id", roomId)
      .select()
      .single()

    if (updateRoomError) {
      console.error("resetRoom: Error resetting room state:", updateRoomError)
      return { success: false, error: updateRoomError.message }
    }

    revalidatePath("/")
    return { success: true, error: null }
  } catch (error: any) {
    console.error("resetRoom: Caught exception:", error.message)
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
      .order("created_at", { ascending: true })

    if (error) {
      console.error("getPlayersInRoom: Error fetching players in room:", error)
      return { players: [], error: error.message }
    }
    return { players: data, error: null }
  } catch (error: any) {
    console.error("getPlayersInRoom: Caught exception:", error.message)
    return { players: [], error: error.message }
  }
}
