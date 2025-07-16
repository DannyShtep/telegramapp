"use server"

import { revalidatePath } from "next/cache"
import { createServerComponentClient } from "@/lib/supabase"
import type { Player, SupabasePlayer } from "@/types/player"

const playerColors = ["#ef4444", "#22c55e", "#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899"]

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
    username: supabasePlayer.username,
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
  console.log(`[Server Action] getOrCreateRoom: Attempting to get or create room ${roomId}`)
  try {
    const supabase = await getSupabase()

    const { data: room, error: fetchError } = await supabase.from("rooms").select("*").eq("id", roomId).single()

    if (fetchError && fetchError.code === "PGRST116") {
      console.log(`[Server Action] getOrCreateRoom: Room ${roomId} not found, creating new.`)
      const { data: newRoom, error: createError } = await supabase
        .from("rooms")
        .insert({ id: roomId, status: "waiting", countdown: 20, total_gifts: 0, total_ton: 0 })
        .select()
        .single()

      if (createError) {
        console.error("[Server Action] Error creating room:", createError)
        return { room: null, error: createError.message }
      }
      console.log(`[Server Action] getOrCreateRoom: Room ${roomId} created successfully.`)
      return { room: newRoom, error: null }
    } else if (fetchError) {
      console.error("[Server Action] Error fetching room:", fetchError)
      return { room: null, error: fetchError.message }
    }

    console.log(`[Server Action] getOrCreateRoom: Room ${roomId} fetched successfully. Status: ${room?.status}`)
    return { room, error: null }
  } catch (error: any) {
    console.error("[Server Action] Caught exception in getOrCreateRoom:", error.message, error.stack)
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
  console.log(`[Server Action] ensureUserOnline: Starting for telegramId=${telegramId}, room=${roomId}`)
  try {
    const supabase = await getSupabase()

    const { data: existingPlayer, error: fetchPlayerError } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", roomId)
      .eq("telegram_id", telegramId)
      .single()

    if (fetchPlayerError && fetchPlayerError.code !== "PGRST116") {
      console.error("[Server Action] Error fetching existing player in ensureUserOnline:", fetchPlayerError)
      return { success: false, error: fetchPlayerError.message }
    }

    if (existingPlayer) {
      console.log(`[Server Action] ensureUserOnline: Player ${telegramId} found, updating last_active_at.`)
      const { error: updateError } = await supabase
        .from("players")
        .update({
          username: telegramUsername,
          display_name: displayName,
          avatar: avatarUrl,
          last_active_at: new Date().toISOString(),
        })
        .eq("id", existingPlayer.id)

      if (updateError) {
        console.error("[Server Action] Error updating existing player in ensureUserOnline:", updateError)
        return { success: false, error: updateError.message }
      }
      console.log(`[Server Action] ensureUserOnline: Player ${telegramId} updated successfully.`)
    } else {
      console.log(`[Server Action] ensureUserOnline: Player ${telegramId} not found, inserting new observer.`)
      const newPlayerData = {
        id: `online_${telegramId}_${Date.now()}`,
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
        last_active_at: new Date().toISOString(),
      }

      const { error: insertError } = await supabase.from("players").insert(newPlayerData)

      if (insertError) {
        console.error("[Server Action] Error inserting new online player in ensureUserOnline:", insertError)
        return { success: false, error: insertError.message }
      }
      console.log(`[Server Action] ensureUserOnline: New observer ${telegramId} inserted successfully.`)
    }

    revalidatePath("/")
    return { success: true, error: null }
  } catch (error: any) {
    console.error("[Server Action] Caught exception in ensureUserOnline:", error.message, error.stack)
    return { success: false, error: error.message }
  }
}

// Функция для добавления игрока в комнату или обновления его статуса
export async function addPlayerToRoom(roomId: string, playerData: Player) {
  console.log(`[Server Action] addPlayerToRoom: telegramId=${playerData.telegramId}, tonValue=${playerData.tonValue}`)

  try {
    const supabase = await getSupabase()

    // Сначала получаем текущих участников для определения цвета
    const { data: currentParticipants, error: fetchParticipantsError } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", roomId)
      .eq("is_participant", true)
      .order("created_at", { ascending: true })

    if (fetchParticipantsError) {
      console.error("[Server Action] Error fetching current participants:", fetchParticipantsError)
      return { player: null, error: fetchParticipantsError.message }
    }

    // Проверяем, есть ли уже этот игрок среди участников
    const existingParticipant = currentParticipants.find((p) => p.telegram_id === playerData.telegramId)

    let playerColor = playerData.color
    if (!existingParticipant) {
      // Если это новый участник, назначаем ему цвет
      playerColor = playerColors[currentParticipants.length % playerColors.length]
    } else {
      // Если игрок уже участвует, сохраняем его цвет
      playerColor = existingParticipant.color
    }

    const playerToUpsert = {
      id: playerData.id,
      room_id: roomId,
      telegram_id: playerData.telegramId,
      username: playerData.username,
      display_name: playerData.displayName,
      avatar: playerData.avatar,
      gifts: playerData.gifts,
      ton_value: playerData.tonValue,
      color: playerColor, // Используем правильный цвет
      percentage: playerData.percentage,
      is_participant: playerData.isParticipant,
      last_active_at: new Date().toISOString(),
    }

    console.log("[Server Action] Upserting player with color:", playerColor)

    // Используем upsert для обновления или вставки
    const { data: upsertedPlayer, error: upsertError } = await supabase
      .from("players")
      .upsert(playerToUpsert, {
        onConflict: "room_id,telegram_id",
        ignoreDuplicates: false,
      })
      .select()
      .single()

    if (upsertError) {
      console.error("[Server Action] Upsert error:", upsertError)
      return { player: null, error: upsertError.message }
    }

    const clientPlayer = mapSupabasePlayerToClientPlayer(upsertedPlayer as SupabasePlayer)
    console.log("[Server Action] Player upserted successfully with color:", clientPlayer.color)

    revalidatePath("/")
    return { player: clientPlayer, error: null }
  } catch (error: any) {
    console.error("[Server Action] Exception in addPlayerToRoom:", error.message, error.stack)
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
  console.log(`[Server Action] updateRoomState: Updating room ${roomId} with state:`, newState)
  try {
    const supabase = await getSupabase()

    const { data, error } = await supabase.from("rooms").update(newState).eq("id", roomId).select().single()

    if (error) {
      console.error("[Server Action] Error updating room state:", error)
      return { room: null, error: error.message }
    }
    console.log("[Server Action] Room state updated successfully:", data)

    revalidatePath("/")
    return { room: data, error: null }
  } catch (error: any) {
    console.error("[Server Action] Caught exception in updateRoomState:", error.message, error.stack)
    return { room: null, error: error.message }
  }
}

// Функция для сброса комнаты
export async function resetRoom(roomId: string, skipRevalidation = false) {
  console.log("[Server Action] resetRoom: Starting reset for room:", roomId)
  try {
    const supabase = await getSupabase()

    // Сбрасываем статус участника и ставки
    const { error: updatePlayersError } = await supabase
      .from("players")
      .update({
        is_participant: false,
        gifts: 0,
        ton_value: 0,
      })
      .eq("room_id", roomId)

    if (updatePlayersError) {
      console.error("[Server Action] Error resetting players in resetRoom:", updatePlayersError)
      return { success: false, error: updatePlayersError.message }
    }
    console.log("[Server Action] resetRoom: Players in room reset successfully.")

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
      console.error("[Server Action] Error resetting room state in resetRoom:", updateRoomError)
      return { success: false, error: updateRoomError.message }
    }
    console.log("[Server Action] resetRoom: Room state reset successfully:", room)

    if (!skipRevalidation) {
      revalidatePath("/")
    }
    return { success: true, error: null }
  } catch (error: any) {
    console.error("[Server Action] Caught exception in resetRoom:", error.message, error.stack)
    return { success: false, error: error.message }
  }
}

// Функция для получения всех игроков в комнате (для модального окна "Онлайн")
export async function getPlayersInRoom(roomId: string) {
  console.log(`[Server Action] getPlayersInRoom: Fetching online players for room ${roomId}`)
  try {
    const supabase = await getSupabase()

    const activeThreshold = new Date(Date.now() - 45 * 1000).toISOString()

    const { data, error } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", roomId)
      .gt("last_active_at", activeThreshold)
      .order("created_at", { ascending: true })

    if (error) {
      console.error("[Server Action] Error fetching players in getPlayersInRoom:", error)
      return { players: [], error: error.message }
    }

    const clientPlayers: Player[] = (data as SupabasePlayer[]).map(mapSupabasePlayerToClientPlayer)
    console.log(`[Server Action] getPlayersInRoom: Found ${clientPlayers.length} active players.`)
    return { players: clientPlayers, error: null }
  } catch (error: any) {
    console.error("[Server Action] Caught exception in getPlayersInRoom:", error.message, error.stack)
    return { players: [], error: error.message }
  }
}

// Получение участников игры (тех, кто сделал ставку)
export async function getParticipants(roomId: string) {
  console.log(`[Server Action] getParticipants: Fetching participants for room ${roomId}`)
  try {
    const supabase = await getSupabase()

    const { data, error } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", roomId)
      .eq("is_participant", true)
      .order("created_at", { ascending: true })

    if (error) {
      console.error("[Server Action] Error fetching participants:", error)
      return { participants: [], error: error.message }
    }
    const clientParticipants: Player[] = (data as SupabasePlayer[]).map(mapSupabasePlayerToClientPlayer)
    console.log(`[Server Action] getParticipants: Found ${clientParticipants.length} participants.`)
    return { participants: clientParticipants, error: null }
  } catch (error: any) {
    console.error("[Server Action] Caught exception in getParticipants:", error.message, error.stack)
    return { participants: [], error: error.message }
  }
}

// Функция для определения победителя и обновления статуса комнаты
export async function determineWinnerAndSpin(roomId: string) {
  console.log("[Server Action] determineWinnerAndSpin: Starting for room", roomId)
  try {
    const supabase = await getSupabase()

    const { participants: participantsData, error: fetchError } = await getParticipants(roomId)

    if (fetchError) {
      console.error("[Server Action] Error fetching participants for winner selection:", fetchError)
      return { winner: null, error: fetchError.message }
    }

    const participants = participantsData

    if (participants.length === 0) {
      console.warn("[Server Action] No participants to determine winner from. Resetting room.")
      await resetRoom(roomId)
      return { winner: null, error: "No participants" }
    }

    const totalTon = participants.reduce((sum, p) => sum + p.tonValue, 0)
    if (totalTon === 0) {
      console.warn("[Server Action] Total TON is zero, cannot determine winner. Resetting room.")
      await resetRoom(roomId)
      return { winner: null, error: "Total TON is zero" }
    }

    // Случайным образом выбираем победителя на основе веса ТОН
    let randomNumber = Math.random() * totalTon
    let winner: Player | null = null

    for (const p of participants) {
      randomNumber -= p.tonValue
      if (randomNumber <= 0) {
        winner = p
        break
      }
    }

    if (!winner) {
      winner = participants[0]
      console.warn("[Server Action] Fallback: Winner not selected by random, picking first participant.")
    }
    console.log("[Server Action] Determined winner:", winner?.displayName, "with Telegram ID:", winner?.telegramId)

    const { data: updatedRoom, error: updateError } = await supabase
      .from("rooms")
      .update({
        status: "spinning",
        winner_telegram_id: winner.telegramId,
      })
      .eq("id", roomId)
      .select()
      .single()

    if (updateError) {
      console.error("[Server Action] Error updating room with winner:", updateError)
      return { winner: null, error: updateError.message }
    }
    console.log("[Server Action] Room status set to 'spinning' with winner:", updatedRoom)

    revalidatePath("/")
    return { winner: mapSupabasePlayerToClientPlayer(winner as SupabasePlayer), error: null }
  } catch (error: any) {
    console.error("[Server Action] Caught exception in determineWinnerAndSpin:", error.message, error.stack)
    return { winner: null, error: error.message }
  }
}
