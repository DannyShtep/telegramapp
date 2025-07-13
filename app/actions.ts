"use server"

import { revalidatePath } from "next/cache"
import { createServerComponentClient } from "@/lib/supabase"

/** Проверяем, инициализирован ли Supabase-клиент.
 *  В preview-режиме он может быть null, тогда Server Action
 *  возвращает «заглушку», чтобы не падать. */
function guardSupabase<T>(client: any, fallback: T): T {
  if (!client) {
    console.warn("Supabase client is NOT configured. Server action returns fallback result.")
    return fallback
  }
  // @ts-expect-error — компилятору ок, реальный объект дальше в коде
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
  const supabase = guardSupabase(
    createServerComponentClient(),
    null as unknown as ReturnType<typeof createServerComponentClient>,
  )
  if (!supabase) {
    console.warn("getOrCreateRoom: Supabase client is null. Returning mock room data.")
    return {
      room: {
        id: roomId,
        status: "waiting",
        countdown: 20,
        winner_telegram_id: null,
        total_gifts: 0,
        total_ton: 0,
      },
      error: null,
    }
  }

  // Попытка получить комнату
  const { data: room, error: fetchError } = await supabase.from("rooms").select("*").eq("id", roomId).single()

  if (fetchError && fetchError.code === "PGRST116") {
    // Комната не найдена, создаем новую
    console.log("getOrCreateRoom: Room not found, creating new room.")
    const { data: newRoom, error: createError } = await supabase
      .from("rooms")
      .insert({ id: roomId, status: "waiting", countdown: 20, total_gifts: 0, total_ton: 0 })
      .select()
      .single()

    if (createError) {
      console.error("getOrCreateRoom: Error creating room:", createError)
      return { room: null, error: createError.message }
    }
    console.log("getOrCreateRoom: New room created:", newRoom)
    return { room: newRoom, error: null }
  } else if (fetchError) {
    console.error("getOrCreateRoom: Error fetching room:", fetchError)
    return { room: null, error: fetchError.message }
  }

  console.log("getOrCreateRoom: Room fetched:", room)
  return { room, error: null }
}

// Функция для добавления игрока в комнату или обновления его статуса
export async function addPlayerToRoom(roomId: string, playerData: PlayerData) {
  const supabase = guardSupabase(
    createServerComponentClient(),
    null as unknown as ReturnType<typeof createServerComponentClient>,
  )
  if (!supabase) {
    console.warn("addPlayerToRoom: Supabase client is null. Returning mock success.")
    // Возвращаем «успех»/пустые данные, чтобы клиент не упал
    return { success: true, player: null, room: null, players: [], error: null } as any
  }

  console.log("addPlayerToRoom: Attempting to add/update player with data:", playerData)

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
    console.log("addPlayerToRoom: Existing player found, updating...")
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
    console.log("addPlayerToRoom: No existing player found, inserting new player...")
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

  console.log("addPlayerToRoom: Player operation successful. Revalidating path.")
  revalidatePath("/") // Перевалидируем путь, чтобы обновить данные на клиенте
  return { player: playerResult.data, error: null }
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
  const supabase = guardSupabase(
    createServerComponentClient(),
    null as unknown as ReturnType<typeof createServerComponentClient>,
  )
  if (!supabase) {
    console.warn("updateRoomState: Supabase client is null. Returning mock success.")
    // Возвращаем «успех»/пустые данные, чтобы клиент не упал
    return { success: true, player: null, room: null, players: [], error: null } as any
  }
  console.log("updateRoomState: Attempting to update room state:", newState)
  const { data, error } = await supabase.from("rooms").update(newState).eq("id", roomId).select().single()

  if (error) {
    console.error("updateRoomState: Error updating room state:", error)
    return { room: null, error: error.message }
  }

  console.log("updateRoomState: Room state updated successfully. Revalidating path.")
  revalidatePath("/")
  return { room: data, error: null }
}

// Функция для сброса комнаты
export async function resetRoom(roomId: string) {
  const supabase = guardSupabase(
    createServerComponentClient(),
    null as unknown as ReturnType<typeof createServerComponentClient>,
  )
  if (!supabase) {
    console.warn("resetRoom: Supabase client is null. Returning mock success.")
    // Возвращаем «успех»/пустые данные, чтобы клиент не упал
    return { success: true, player: null, room: null, players: [], error: null } as any
  }

  console.log("resetRoom: Attempting to reset room and delete players.")
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

  console.log("resetRoom: Room reset successful. Revalidating path.")
  revalidatePath("/")
  return { success: true, error: null }
}

// Функция для получения всех игроков в комнате
export async function getPlayersInRoom(roomId: string) {
  const supabase = guardSupabase(
    createServerComponentClient(),
    null as unknown as ReturnType<typeof createServerComponentClient>,
  )
  if (!supabase) {
    console.warn("getPlayersInRoom: Supabase client is null. Returning empty players array.")
    // Возвращаем «успех»/пустые данные, чтобы клиент не упал
    return { success: true, player: null, room: null, players: [], error: null } as any
  }
  console.log("getPlayersInRoom: Attempting to fetch players for room:", roomId)
  const { data, error } = await supabase
    .from("players")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true })

  if (error) {
    console.error("getPlayersInRoom: Error fetching players in room:", error)
    return { players: [], error: error.message }
  }
  console.log("getPlayersInRoom: Players fetched:", data)
  return { players: data, error: null }
}
