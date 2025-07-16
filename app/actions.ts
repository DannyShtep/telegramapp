"use server"

import { revalidatePath } from "next/cache"
import { createServerComponentClient } from "@/lib/supabase"
import type { Player, SupabasePlayer } from "@/types/player" // Импортируем интерфейсы

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
  }
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
      console.error("Error fetching existing player in ensureUserOnline:", fetchPlayerError)
      return { success: false, error: fetchPlayerError.message }
    }

    if (existingPlayer) {
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
        console.error("Error updating existing player in ensureUserOnline:", updateError)
        return { success: false, error: updateError.message }
      }
    } else {
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
        console.error("Error inserting new online player in ensureUserOnline:", insertError)
        return { success: false, error: insertError.message }
      }
    }

    revalidatePath("/")
    return { success: true, error: null }
  } catch (error: any) {
    console.error("Caught exception in ensureUserOnline:", error.message)
    return { success: false, error: error.message }
  }
}

// Функция для добавления игрока в комнату или обновления его статуса
export async function addPlayerToRoom(roomId: string, playerData: Player) {
  // Используем Player интерфейс
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
      console.error("Error fetching existing player in addPlayerToRoom:", fetchPlayerError)
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
          last_active_at: new Date().toISOString(), // Обновляем время последней активности
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
          display_name: playerData.displayName, // Сохраняем как display_name
          avatar: playerData.avatar,
          gifts: playerData.gifts,
          ton_value: playerData.tonValue,
          color: playerData.color,
          percentage: playerData.percentage,
          is_participant: playerData.isParticipant,
          last_active_at: new Date().toISOString(), // Устанавливаем время активности при создании
        })
        .select()
        .single()
      playerResult = { data, error }
    }

    if (playerResult.error) {
      console.error("Error adding/updating player in addPlayerToRoom:", playerResult.error)
      return { player: null, error: playerResult.error.message }
    }

    // Преобразуем результат перед возвратом на клиент
    const clientPlayer = mapSupabasePlayerToClientPlayer(playerResult.data as SupabasePlayer)

    revalidatePath("/") // Перевалидируем путь, чтобы обновить данные на клиенте
    return { player: clientPlayer, error: null }
  } catch (error: any) {
    console.error("Caught exception in addPlayerToRoom:", error.message)
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
      console.error("Error updating room state:", error)
      return { room: null, error: error.message }
    }

    revalidatePath("/")
    return { room: data, error: null }
  } catch (error: any) {
    console.error("Caught exception in updateRoomState:", error.message)
    return { room: null, error: error.message }
  }
}

// Функция для сброса комнаты
export async function resetRoom(roomId: string) {
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
      console.error("Error resetting players in resetRoom:", updatePlayersError)
      return { success: false, error: updatePlayersError.message }
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
      console.error("Error resetting room state in resetRoom:", updateRoomError)
      return { success: false, error: updateRoomError.message }
    }

    revalidatePath("/")
    return { success: true, error: null }
  } catch (error: any) {
    console.error("Caught exception in resetRoom:", error.message)
    return { success: false, error: error.message }
  }
}

// Функция для получения всех игроков в комнате (для модального окна "Онлайн")
export async function getPlayersInRoom(roomId: string) {
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
      console.error("Error fetching players in getPlayersInRoom:", error)
      return { players: [], error: error.message }
    }

    // Преобразуем полученные данные в camelCase формат
    const clientPlayers: Player[] = (data as SupabasePlayer[]).map(mapSupabasePlayerToClientPlayer)

    return { players: clientPlayers, error: null }
  } catch (error: any) {
    console.error("Caught exception in getPlayersInRoom:", error.message)
    return { players: [], error: error.message }
  }
}

// НОВАЯ ФУНКЦИЯ: Получение участников игры (тех, кто сделал ставку)
export async function getParticipants(roomId: string) {
  try {
    const supabase = await getSupabase()

    const { data, error } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", roomId)
      .eq("is_participant", true) // Только участники, сделавшие ставку
      .order("created_at", { ascending: true })

    if (error) {
      console.error("Error fetching participants:", error)
      return { participants: [], error: error.message }
    }
    const clientParticipants: Player[] = (data as SupabasePlayer[]).map(mapSupabasePlayerToClientPlayer)
    return { participants: clientParticipants, error: null }
  } catch (error: any) {
    console.error("Caught exception in getParticipants:", error.message)
    return { participants: [], error: error.message }
  }
}

// Новая функция для определения победителя и обновления статуса комнаты
export async function determineWinnerAndSpin(roomId: string) {
  try {
    const supabase = await getSupabase()

    // 1. Получаем текущих участников (используем новую функцию)
    const { participants: participantsData, error: fetchError } = await getParticipants(roomId)

    if (fetchError) {
      console.error("Error fetching participants for winner selection:", fetchError)
      return { winner: null, error: fetchError.message }
    }

    const participants = participantsData

    if (participants.length === 0) {
      console.warn("No participants to determine winner from. Resetting room.")
      await resetRoom(roomId)
      return { winner: null, error: "No participants" }
    }

    // 2. Вычисляем общий ТОН и создаем взвешенный список
    const totalTon = participants.reduce((sum, p) => sum + p.tonValue, 0)
    if (totalTon === 0) {
      console.warn("Total TON is zero, cannot determine winner. Resetting room.")
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
      // Запасной вариант: если по какой-то причине победитель не был выбран (чего не должно быть при правильной логике), выбираем первого
      winner = participants[0]
      console.warn("Fallback: Winner not selected by random, picking first participant.")
    }

    // 3. Обновляем состояние комнаты с победителем и статусом
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
      console.error("Error updating room with winner:", updateError)
      return { winner: null, error: updateError.message }
    }

    revalidatePath("/")
    return { winner: mapSupabasePlayerToClientPlayer(winner as SupabasePlayer), error: null }
  } catch (error: any) {
    console.error("Caught exception in determineWinnerAndSpin:", error.message)
    return { winner: null, error: error.message }
  }
}
