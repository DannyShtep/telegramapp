"use server"

import { createServerComponentClient } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import type { TelegramUser } from "./types/telegram"

// Вспомогательная функция для получения Supabase клиента на сервере
const getSupabase = () => {
  const cookieStore = cookies()
  return createServerComponentClient()
}

// Типы для данных из базы данных
interface DbRoom {
  id: string
  status: string
  countdown: number
  winner_telegram_id: number | null
  total_gifts: number
  total_ton: number
}

interface DbPlayer {
  id: string
  room_id: string
  telegram_id: number
  username: string | null
  display_name: string
  avatar: string | null
  gifts: number
  ton_value: number
  color: string | null
  percentage: number
  is_participant: boolean
}

const playerColors = ["#ef4444", "#22c55e", "#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899"]

// Функция для присоединения к комнате
export async function joinRoom(roomId: string, telegramUser: TelegramUser) {
  const supabase = getSupabase()

  try {
    // Проверяем, существует ли комната
    let { data: room, error: roomError } = await supabase.from("rooms").select("*").eq("id", roomId).single()

    if (roomError && roomError.code === "PGRST116") {
      // Room not found
      // Если комнаты нет, создаем новую
      const { data: newRoom, error: createRoomError } = await supabase.from("rooms").insert({}).select().single()

      if (createRoomError) {
        console.error("Error creating room:", createRoomError)
        return { success: false, message: "Ошибка при создании комнаты." }
      }
      room = newRoom
    } else if (roomError) {
      console.error("Error fetching room:", roomError)
      return { success: false, message: "Ошибка при получении данных комнаты." }
    }

    // Проверяем, есть ли уже игрок в этой комнате
    const { data: existingPlayer, error: playerError } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", room.id)
      .eq("telegram_id", telegramUser.id)
      .single()

    if (playerError && playerError.code !== "PGRST116") {
      // Not found is ok
      console.error("Error checking existing player:", playerError)
      return { success: false, message: "Ошибка при проверке игрока." }
    }

    if (!existingPlayer) {
      // Добавляем игрока как наблюдателя
      const { error: insertPlayerError } = await supabase.from("players").insert({
        room_id: room.id,
        telegram_id: telegramUser.id,
        username: telegramUser.username,
        display_name: telegramUser.first_name + (telegramUser.last_name ? " " + telegramUser.last_name : ""),
        avatar: telegramUser.photo_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${telegramUser.id}`,
        is_participant: false, // Изначально как наблюдатель
      })

      if (insertPlayerError) {
        console.error("Error inserting player:", insertPlayerError)
        return { success: false, message: "Ошибка при добавлении игрока в комнату." }
      }
    }

    revalidatePath("/") // Перезагружаем данные на клиенте
    return { success: true, message: "Вы успешно присоединились к комнате!", roomId: room.id }
  } catch (error) {
    console.error("Unhandled error in joinRoom:", error)
    return { success: false, message: "Произошла непредвиденная ошибка." }
  }
}

// Функция для добавления подарка/TON
export async function addGift(roomId: string, telegramUser: TelegramUser, tonAmountToAdd?: number) {
  const supabase = getSupabase()

  try {
    // Получаем текущее состояние комнаты и игрока
    const { data: room, error: roomError } = await supabase.from("rooms").select("*").eq("id", roomId).single()

    if (roomError) {
      console.error("Error fetching room for addGift:", roomError)
      return { success: false, message: "Комната не найдена." }
    }

    if (
      room.status === "spinning" ||
      room.status === "finished" ||
      (room.status === "countdown" && room.countdown <= 3)
    ) {
      return { success: false, message: "Нельзя добавить подарок в текущем состоянии игры." }
    }

    let { data: player, error: playerError } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", roomId)
      .eq("telegram_id", telegramUser.id)
      .single()

    if (playerError && playerError.code === "PGRST116") {
      // Если игрока нет, добавляем его как участника
      const participantCount =
        (
          await supabase
            .from("players")
            .select("*", { count: "exact" })
            .eq("room_id", roomId)
            .eq("is_participant", true)
        ).count || 0
      const newTonValue = tonAmountToAdd !== undefined ? tonAmountToAdd : Math.random() * 20 + 5

      const { data: newPlayer, error: insertError } = await supabase
        .from("players")
        .insert({
          room_id: roomId,
          telegram_id: telegramUser.id,
          username: telegramUser.username,
          display_name: telegramUser.first_name + (telegramUser.last_name ? " " + telegramUser.last_name : ""),
          avatar: telegramUser.photo_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${telegramUser.id}`,
          gifts: 1,
          ton_value: newTonValue,
          color: playerColors[participantCount % playerColors.length],
          is_participant: true,
        })
        .select()
        .single()

      if (insertError) {
        console.error("Error inserting new participant:", insertError)
        return { success: false, message: "Ошибка при добавлении нового участника." }
      }
      player = newPlayer
    } else if (playerError) {
      console.error("Error fetching player for addGift:", playerError)
      return { success: false, message: "Ошибка при получении данных игрока." }
    } else if (player && !player.is_participant) {
      // Если игрок был наблюдателем, делаем его участником
      const participantCount =
        (
          await supabase
            .from("players")
            .select("*", { count: "exact" })
            .eq("room_id", roomId)
            .eq("is_participant", true)
        ).count || 0
      const newTonValue = tonAmountToAdd !== undefined ? tonAmountToAdd : Math.random() * 20 + 5

      const { data: updatedPlayer, error: updatePlayerError } = await supabase
        .from("players")
        .update({
          gifts: 1,
          ton_value: newTonValue,
          color: playerColors[participantCount % playerColors.length],
          is_participant: true,
        })
        .eq("id", player.id)
        .select()
        .single()

      if (updatePlayerError) {
        console.error("Error updating observer to participant:", updatePlayerError)
        return { success: false, message: "Ошибка при обновлении статуса игрока." }
      }
      player = updatedPlayer
    } else if (player && player.is_participant) {
      // Если игрок уже участник, увеличиваем его подарки/TON
      const newTonValue = player.ton_value + (tonAmountToAdd !== undefined ? tonAmountToAdd : Math.random() * 20 + 5)
      const { data: updatedPlayer, error: updatePlayerError } = await supabase
        .from("players")
        .update({
          gifts: player.gifts + 1,
          ton_value: newTonValue,
        })
        .eq("id", player.id)
        .select()
        .single()

      if (updatePlayerError) {
        console.error("Error updating existing participant:", updatePlayerError)
        return { success: false, message: "Ошибка при обновлении подарков игрока." }
      }
      player = updatedPlayer
    }

    // Пересчитываем общие подарки/TON и проценты для всех участников
    const { data: allParticipants, error: participantsError } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", roomId)
      .eq("is_participant", true)

    if (participantsError) {
      console.error("Error fetching all participants:", participantsError)
      return { success: false, message: "Ошибка при получении списка участников." }
    }

    const newTotalTon = allParticipants.reduce((sum, p) => sum + p.ton_value, 0)
    const newTotalGifts = allParticipants.length

    // Обновляем проценты для всех участников
    for (const p of allParticipants) {
      const newPercentage = (p.ton_value / newTotalTon) * 100
      await supabase.from("players").update({ percentage: newPercentage }).eq("id", p.id)
    }

    // Обновляем статус комнаты и общие значения
    const newStatus =
      allParticipants.length === 1 ? "single_player" : allParticipants.length >= 2 ? "countdown" : "waiting"
    const { error: updateRoomError } = await supabase
      .from("rooms")
      .update({
        total_gifts: newTotalGifts,
        total_ton: newTotalTon,
        status: newStatus,
        countdown: newStatus === "countdown" ? 20 : room.countdown, // Сбрасываем таймер при переходе в countdown
      })
      .eq("id", roomId)

    if (updateRoomError) {
      console.error("Error updating room state:", updateRoomError)
      return { success: false, message: "Ошибка при обновлении состояния комнаты." }
    }

    revalidatePath("/")
    return { success: true, message: "Подарок успешно добавлен!" }
  } catch (error) {
    console.error("Unhandled error in addGift:", error)
    return { success: false, message: "Произошла непредвиденная ошибка." }
  }
}

// Функция для запуска таймера и рулетки (вызывается из useEffect на клиенте)
export async function updateRoomCountdown(
  roomId: string,
  newCountdown: number,
  newStatus: string,
  winnerTelegramId?: number,
) {
  const supabase = getSupabase()
  try {
    const updateData: { countdown: number; status: string; winner_telegram_id?: number | null } = {
      countdown: newCountdown,
      status: newStatus,
    }
    if (winnerTelegramId !== undefined) {
      updateData.winner_telegram_id = winnerTelegramId
    } else if (newStatus === "waiting") {
      updateData.winner_telegram_id = null // Сбрасываем победителя при сбросе игры
    }

    const { error } = await supabase.from("rooms").update(updateData).eq("id", roomId)

    if (error) {
      console.error("Error updating room countdown/status:", error)
      return { success: false, message: "Ошибка при обновлении таймера комнаты." }
    }
    revalidatePath("/")
    return { success: true, message: "Таймер комнаты обновлен." }
  } catch (error) {
    console.error("Unhandled error in updateRoomCountdown:", error)
    return { success: false, message: "Произошла непредвиденная ошибка." }
  }
}

// Функция для сброса комнаты
export async function resetRoom(roomId: string) {
  const supabase = getSupabase()
  try {
    // Удаляем всех игроков из комнаты
    const { error: deletePlayersError } = await supabase.from("players").delete().eq("room_id", roomId)

    if (deletePlayersError) {
      console.error("Error deleting players:", deletePlayersError)
      return { success: false, message: "Ошибка при сбросе игроков." }
    }

    // Сбрасываем состояние комнаты
    const { error: updateRoomError } = await supabase
      .from("rooms")
      .update({
        status: "waiting",
        countdown: 20,
        winner_telegram_id: null,
        total_gifts: 0,
        total_ton: 0,
      })
      .eq("id", roomId)

    if (updateRoomError) {
      console.error("Error resetting room:", updateRoomError)
      return { success: false, message: "Ошибка при сбросе комнаты." }
    }

    revalidatePath("/")
    return { success: true, message: "Комната успешно сброшена." }
  } catch (error) {
    console.error("Unhandled error in resetRoom:", error)
    return { success: false, message: "Произошла непредвиденная ошибка." }
  }
}
