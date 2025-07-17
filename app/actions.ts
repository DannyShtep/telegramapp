"use server"

// import { revalidatePath } from "next/cache" // Удаляем импорт revalidatePath
import { createServerComponentClient } from "@/lib/supabase"
import type { Player, SupabasePlayer, Room } from "@/types/player" // Импортируем интерфейсы

/** Returns Supabase client. Throws an error if env vars are missing. */
export async function getSupabase() {
  const client = createServerComponentClient()
  // createServerComponentClient уже выбрасывает ошибку, если переменные окружения не настроены.
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
    // Используем display_name, если есть, иначе username, иначе fallback
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
    lastActiveAt: supabasePlayer.last_active_at, // Добавляем lastActiveAt
  }
}

// Функция для получения или создания комнаты
export async function getOrCreateRoom(roomId = "default-room-id") {
  console.log(`[Server Action] getOrCreateRoom: Attempting to get or create room ${roomId}`)
  try {
    const supabase = await getSupabase()

    // Попытка получить комнату
    const { data: room, error: fetchError } = await supabase.from("rooms").select("*").eq("id", roomId).single()

    if (fetchError && fetchError.code === "PGRST116") {
      // PGRST116 означает "строки не найдены"
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
      return { room: newRoom as Room, error: null } // Приводим к типу Room
    } else if (fetchError) {
      console.error("[Server Action] Error fetching room:", fetchError)
      return { room: null, error: fetchError.message }
    }

    console.log(`[Server Action] getOrCreateRoom: Room ${roomId} fetched successfully. Status: ${room?.status}`)
    return { room: room as Room, error: null } // Приводим к типу Room
  } catch (error: any) {
    console.error("[Server Action] Caught exception in getOrCreateRoom:", error.message, error.stack)
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
  console.log(`[Server Action] ensureUserOnline: Starting for telegramId=${telegramId}, room=${roomId}`)
  try {
    const supabase = await getSupabase()

    // !!! ВАЖНО: Логируем данные пользователя, которые приходят в Server Action !!!
    console.log(
      `[Server Action] ensureUserOnline - Received: telegramId=${telegramId}, username=${telegramUsername}, avatar=${avatarUrl}, displayName=${displayName}`,
    )

    const { data: existingPlayer, error: fetchPlayerError } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", roomId)
      .eq("telegram_id", telegramId)
      .single()

    if (fetchPlayerError && fetchPlayerError.code !== "PGRST116") {
      // PGRST116 означает "строки не найдены"
      console.error("[Server Action] Error fetching existing player in ensureUserOnline:", fetchPlayerError)
      return { success: false, error: fetchPlayerError.message }
    }

    if (existingPlayer) {
      console.log(`[Server Action] ensureUserOnline: Player ${telegramId} found, updating last_active_at.`)
      // Если игрок уже есть, просто обновляем его данные (на случай смены ника/аватара)
      const { error: updateError } = await supabase
        .from("players")
        .update({
          username: telegramUsername,
          display_name: displayName, // Сохраняем как display_name
          avatar: avatarUrl,
          last_active_at: new Date().toISOString(), // Обновляем время последней активности
        })
        .eq("id", existingPlayer.id)

      if (updateError) {
        console.error("[Server Action] Error updating existing player in ensureUserOnline:", updateError)
        return { success: false, error: updateError.message }
      }
      console.log(`[Server Action] ensureUserOnline: Player ${telegramId} updated successfully.`)
    } else {
      console.log(`[Server Action] ensureUserOnline: Player ${telegramId} not found, inserting new observer.`)
      // Если игрока нет, добавляем его как наблюдателя (isParticipant: false)
      const newPlayerData = {
        id: `online_${telegramId}_${Date.now()}`, // Уникальный ID для онлайн-статуса
        room_id: roomId,
        telegram_id: telegramId,
        username: telegramUsername,
        display_name: displayName, // Сохраняем как display_name
        avatar: avatarUrl,
        gifts: 0,
        ton_value: 0,
        color: "#4b5563", // Цвет по умолчанию для наблюдателей
        percentage: 0,
        is_participant: false, // Важно: это наблюдатель
        last_active_at: new Date().toISOString(), // Устанавливаем время активности при создании
      }

      const { error: insertError } = await supabase.from("players").insert(newPlayerData)

      if (insertError) {
        console.error("[Server Action] Error inserting new online player in ensureUserOnline:", insertError)
        return { success: false, error: insertError.message }
      }
      console.log(`[Server Action] ensureUserOnline: New observer ${telegramId} inserted successfully.`)
    }

    // revalidatePath("/") // Удалено
    return { success: true, error: null }
  } catch (error: any) {
    console.error("[Server Action] Caught exception in ensureUserOnline:", error.message, error.stack)
    return { success: false, error: error.message }
  }
}

// Функция для добавления игрока в комнату или обновления его статуса
export async function addPlayerToRoom(roomId: string, playerData: Player) {
  console.log(`[Server Action] addPlayerToRoom: Processing player telegramId=${playerData.telegramId}, room=${roomId}`)

  try {
    const supabase = await getSupabase()
    console.log("[Server Action] addPlayerToRoom: Supabase client created")

    // Попытка обновить существующего игрока
    const { data: updatedPlayer, error: updateError } = await supabase
      .from("players")
      .update({
        gifts: playerData.gifts,
        ton_value: playerData.tonValue,
        is_participant: true, // Всегда true, если игрок делает ставку
        last_active_at: new Date().toISOString(),
        // Обновляем username, display_name, avatar, color на случай их изменения
        username: playerData.username,
        display_name: playerData.displayName,
        avatar: playerData.avatar,
        color: playerData.color, // Обновляем цвет, если он изменился на клиенте (для новых игроков)
      })
      .eq("room_id", roomId)
      .eq("telegram_id", playerData.telegramId)
      .select()
      .single()

    if (updateError && updateError.code === "PGRST116") {
      // PGRST116 означает "строки не найдены", значит игрока нет, нужно вставить
      console.log("[Server Action] addPlayerToRoom: Player not found, inserting new.")

      const playerToInsert = {
        id: playerData.id, // Используем ID, переданный с клиента (временный или уже существующий)
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
        last_active_at: new Date().toISOString(),
      }

      const { data: insertedPlayer, error: insertError } = await supabase
        .from("players")
        .insert(playerToInsert)
        .select()
        .single()

      if (insertError) {
        console.error("[Server Action] addPlayerToRoom: Insert error:", insertError)
        return { player: null, error: insertError.message }
      }

      const clientPlayer = mapSupabasePlayerToClientPlayer(insertedPlayer as SupabasePlayer)
      console.log("[Server Action] addPlayerToRoom: New player inserted successfully")
      // revalidatePath("/") // Удалено
      return { player: clientPlayer, error: null }
    } else if (updateError) {
      console.error("[Server Action] addPlayerToRoom: Update error:", updateError)
      return { player: null, error: updateError.message }
    }

    const clientPlayer = mapSupabasePlayerToClientPlayer(updatedPlayer as SupabasePlayer)
    console.log("[Server Action] addPlayerToRoom: Player updated successfully")

    // revalidatePath("/") // Удалено
    return { player: clientPlayer, error: null }
  } catch (error: any) {
    console.error("[Server Action] addPlayerToRoom: Exception:", error.message, error.stack)
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

    // revalidatePath("/") // Удалено
    return { room: data as Room, error: null } // Приводим к типу Room
  } catch (error: any) {
    console.error("[Server Action] Caught exception in updateRoomState:", error.message, error.stack)
    return { room: null, error: error.message }
  }
}

// Функция для сброса комнаты - убираем revalidatePath, если вызывается из API route
export async function resetRoom(roomId: string, skipRevalidation = false) {
  console.log("[Server Action] resetRoom: Starting reset for room:", roomId, "Skip revalidation:", skipRevalidation)
  try {
    const supabase = await getSupabase()

    // Вместо удаления игроков, сбрасываем их статус участника и ставки
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

    // Только вызываем revalidatePath если не пропускаем ревалидацию (т.е. не из API route)
    // if (!skipRevalidation) { // Эта проверка теперь не нужна, так как revalidatePath удален
    //   revalidatePath("/")
    // }
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

    // Фильтруем игроков, которые были активны за последние 45 секунд
    const activeThreshold = new Date(Date.now() - 45 * 1000).toISOString()

    const { data, error } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", roomId)
      .gt("last_active_at", activeThreshold) // Добавляем фильтр по времени активности
      .order("created_at", { ascending: true })

    if (error) {
      console.error("[Server Action] Error fetching players in getPlayersInRoom:", error)
      return { players: [], error: error.message }
    }

    // Преобразуем полученные данные в camelCase формат
    const clientPlayers: Player[] = (data as SupabasePlayer[]).map(mapSupabasePlayerToClientPlayer)
    console.log(`[Server Action] getPlayersInRoom: Found ${clientPlayers.length} active players.`)
    return { players: clientPlayers, error: null }
  } catch (error: any) {
    console.error("[Server Action] Caught exception in getPlayersInRoom:", error.message, error.stack)
    return { players: [], error: error.message }
  }
}

// НОВАЯ ФУНКЦИЯ: Получение участников игры (тех, кто сделал ставку)
export async function getParticipants(roomId: string) {
  console.log(`[Server Action] getParticipants: Fetching participants for room ${roomId}`)
  try {
    const supabase = await getSupabase()

    const { data, error } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", roomId)
      .eq("is_participant", true) // Только участники, сделавшие ставку
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

// Новая функция для определения победителя и обновления статуса комнаты
export async function determineWinnerAndSpin(roomId: string) {
  console.log("[Server Action] determineWinnerAndSpin: Starting for room", roomId)
  try {
    const supabase = await getSupabase()

    // 1. Получаем текущих участников (используем новую функцию)
    console.log("[Server Action] determineWinnerAndSpin: Calling getParticipants.")
    const { participants: participantsData, error: fetchError } = await getParticipants(roomId)

    if (fetchError) {
      console.error("[Server Action] Error fetching participants for winner selection:", fetchError)
      return { winner: null, error: fetchError.message }
    }
    console.log(
      "[Server Action] Participants for winner selection:",
      participantsData.length,
      "players.",
      JSON.stringify(participantsData, null, 2),
    )

    const participants = participantsData

    if (participants.length === 0) {
      console.warn("[Server Action] No participants to determine winner from. Resetting room.")
      await resetRoom(roomId, true) // Пропускаем revalidatePath
      return { winner: null, error: "No participants" }
    }

    // 2. Вычисляем общий ТОН и создаем взвешенный список
    const totalTon = participants.reduce((sum, p) => sum + p.tonValue, 0)
    if (totalTon === 0) {
      console.warn("[Server Action] Total TON is zero, cannot determine winner. Resetting room.")
      await resetRoom(roomId, true) // Пропускаем revalidatePath
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
      // Запасной вариант: если по какой-то причине победитель не был выбран (чего не должно быть при правильной логике), выбираем первого
      winner = participants[0]
      console.warn("[Server Action] Fallback: Winner not selected by random, picking first participant.")
    }
    console.log("[Server Action] Determined winner:", winner?.displayName, "with Telegram ID:", winner?.telegramId)

    // 3. Обновляем состояние комнаты с победителем и статусом
    console.log("[Server Action] determineWinnerAndSpin: Updating room status to 'spinning' with winner.")
    const { data: updatedRoom, error: updateError } = await supabase
      .from("rooms")
      .update({
        status: "spinning", // Устанавливаем статус "spinning" немедленно
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

    // revalidatePath("/") // Удалено
    return { winner: mapSupabasePlayerToClientPlayer(winner as SupabasePlayer), error: null }
  } catch (error: any) {
    console.error("[Server Action] Caught exception in determineWinnerAndSpin:", error.message, error.stack)
    return { winner: null, error: error.message }
  }
}
