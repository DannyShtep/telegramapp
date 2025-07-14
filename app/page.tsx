"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useTelegram } from "../hooks/useTelegram"
import type { TelegramUser } from "../types/telegram"
import { createClientComponentClient } from "@/lib/supabase"
import { getOrCreateRoom, addPlayerToRoom, updateRoomState, getPlayersInRoom, ensureUserOnline } from "@/app/actions"

interface Player {
  id: string // UUID из Supabase
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

interface RoomState {
  id: string // UUID комнаты
  status: "waiting" | "single_player" | "countdown" | "spinning" | "finished"
  countdown: number
  winner_telegram_id: number | null
  total_gifts: number
  total_ton: number
}

const items = [
  { icon: "💝", label: "PvP" },
  { icon: "🔔", label: "Rolls" },
  { icon: "👤", label: "Мои гифты" },
  { icon: "🏪", label: "Магазин" },
  { icon: "⚡", label: "Заработок" },
]

export default function TelegramRouletteApp() {
  const { user, isReady, hapticFeedback, getUserPhotoUrl, getUserDisplayName, showAlert } = useTelegram() // Импортируем showAlert
  const supabase = createClientComponentClient()

  const defaultRoomId = "default-room-id" // Можно сделать динамическим в будущем

  const [roomState, setRoomState] = useState<RoomState | null>(null)
  const [playersInRoom, setPlayersInRoom] = useState<Player[]>([]) // Все игроки в комнате
  const [rotation, setRotation] = useState(0)
  const [showWinnerModal, setShowWinnerModal] = useState(false)
  const [showPlayersModal, setShowPlayersModal] = useState(false)
  const [displayedTonAmount, setDisplayedTonAmount] = useState(Math.floor(Math.random() * 20 + 5))

  const playerColors = ["#ef4444", "#22c55e", "#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899"]

  // Ref для хранения текущего состояния таймера, чтобы избежать замыканий
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Функция для создания объекта игрока из TelegramUser
  const createPlayerObject = (
    telegramUser: TelegramUser,
    isParticipant: boolean,
    tonValue = 0,
    existingPlayersCount = 0,
  ): Player => {
    return {
      id: `temp_${telegramUser.id}_${Date.now()}`, // Временный ID до сохранения в БД
      telegramId: telegramUser.id,
      username: telegramUser.username || `user${telegramUser.id}`, // Используем username, если есть, иначе fallback
      displayName: getUserDisplayName(telegramUser),
      avatar: getUserPhotoUrl(telegramUser),
      gifts: isParticipant ? 1 : 0,
      tonValue: tonValue,
      color: isParticipant ? playerColors[existingPlayersCount % playerColors.length] : "",
      percentage: 0,
      isParticipant: isParticipant,
    }
  }

  // Инициализация комнаты и подписка на Realtime
  useEffect(() => {
    if (!isReady || !user || !supabase) return

    const initializeRoom = async () => {
      try {
        const { room, error } = await getOrCreateRoom(defaultRoomId)
        if (error) {
          console.error("Room initialization error:", error)
          showAlert(`Room init error: ${error}`) // Отладочное сообщение
          return
        }
        if (room) {
          setRoomState(room)
        }

        const userAvatar = getUserPhotoUrl(user)
        const userDisplayName = getUserDisplayName(user)

        // Добавляем showAlert для проверки данных перед отправкой в Server Action
        showAlert(`Page: User Avatar: ${userAvatar}, Display Name: ${userDisplayName}, Username: ${user.username}`)

        const { success, error: onlineError } = await ensureUserOnline(
          defaultRoomId,
          user.id,
          user.username,
          userAvatar,
          userDisplayName,
        )

        if (onlineError) {
          console.error("Error ensuring user online:", onlineError)
          showAlert(`Ensure user online error: ${onlineError}`) // Отладочное сообщение
        } else if (success) {
          const { players, error } = await getPlayersInRoom(defaultRoomId)
          if (!error && players) {
            setPlayersInRoom(players as Player[])
          } else if (error) {
            console.error("Error fetching players:", error)
            showAlert(`Fetch players error: ${error}`) // Отладочное сообщение
          }
        }
      } catch (error: any) {
        console.error("Exception in initializeRoom:", error)
        showAlert(`Exception in initRoom: ${error.message}`) // Отладочное сообщение
      }
    }

    initializeRoom()

    // Подписка на изменения в таблице rooms
    const roomSubscription = supabase
      .channel(`room:${defaultRoomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `id=eq.${defaultRoomId}` },
        (payload) => {
          if (payload.eventType === "UPDATE" || payload.eventType === "INSERT") {
            setRoomState(payload.new as RoomState)
          }
        },
      )
      .subscribe()

    // Подписка на изменения в таблице players
    const playerSubscription = supabase
      .channel(`players_in_room:${defaultRoomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `room_id=eq.${defaultRoomId}` },
        async (payload) => {
          const { players, error } = await getPlayersInRoom(defaultRoomId)
          if (error) {
            console.error("Error fetching players after realtime update:", error)
            showAlert(`Fetch players after update error: ${error}`) // Отладочное сообщение
            return
          }
          setPlayersInRoom(players as Player[])
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(roomSubscription)
      supabase.removeChannel(playerSubscription)
    }
  }, [isReady, user, supabase, getUserPhotoUrl, getUserDisplayName, showAlert]) // Добавляем showAlert в зависимости

  // ------------------------------------------------------------------
  // Обновляем проценты игроков и запускаем локальную логику таймера/рулетки
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!roomState) return

    const participants = playersInRoom.filter((p) => p.isParticipant)
    const totalTon = participants.reduce((sum, p) => sum + p.tonValue, 0)

    // пересчитаем проценты; если ничего не поменялось — состояние не трогаем
    const playersNext = playersInRoom.map((p) => {
      const newPerc = p.isParticipant && totalTon > 0 ? (p.tonValue / totalTon) * 100 : 0
      return newPerc !== p.percentage ? { ...p, percentage: newPerc } : p
    })

    const hasPlayersChanged = playersNext.some((p, i) => p !== playersInRoom[i])
    if (hasPlayersChanged) {
      setPlayersInRoom(playersNext)
    }

    // ---------- Логика таймера ----------
    if (roomState.status === "countdown" && roomState.countdown > 0) {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)

      countdownIntervalRef.current = setInterval(async () => {
        if (roomState.countdown <= 0) return

        const newCountdown = roomState.countdown - 1

        if (newCountdown <= 3 && newCountdown > 0) hapticFeedback.impact("heavy")

        if (newCountdown === 0) {
          // запуск рулетки и остальная логика...
          const randomRotation = 5400 + Math.random() * 1440
          setRotation((prev) => prev + randomRotation)
          hapticFeedback.impact("heavy")
          await updateRoomState(defaultRoomId, { status: "spinning", countdown: 0 })
          // дальнейшая логика победителя остаётся без изменений
        } else {
          await updateRoomState(defaultRoomId, { countdown: newCountdown })
        }
      }, 1000)
    } else if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = null
    }

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current)
        countdownIntervalRef.current = null
      }
    }
  }, [roomState, playersInRoom, hapticFeedback])

  const handleAddPlayer = useCallback(
    async (isGift = true, tonAmountToAdd?: number) => {
      try {
        if (!user || !roomState || !supabase) {
          console.error("handleAddPlayer: User, roomState or Supabase client is null", { user, roomState, supabase })
          showAlert("AddPlayer: Missing user, room, or supabase.") // Отладочное сообщение
          return
        }

        if (roomState.status === "countdown" && roomState.countdown <= 3) {
          console.error("handleAddPlayer: Cannot add player during final countdown.")
          showAlert("AddPlayer: Cannot add during countdown.") // Отладочное сообщение
          return
        }
        if (roomState.status === "spinning" || roomState.status === "finished") {
          console.error("handleAddPlayer: Cannot add player during spinning or finished state.")
          showAlert("AddPlayer: Cannot add during spin/finish.") // Отладочное сообщение
          return
        }

        const existingParticipant = playersInRoom.find((p) => p.telegramId === user.id && p.isParticipant)
        if (existingParticipant) {
          hapticFeedback.notification("error")
          console.error("handleAddPlayer: User is already a participant.")
          showAlert("AddPlayer: User already participant.") // Отладочное сообщение
          return
        }

        const tonValue = isGift ? Math.random() * 20 + 5 : tonAmountToAdd!
        const newPlayer = createPlayerObject(user, true, tonValue, playersInRoom.filter((p) => p.isParticipant).length)

        hapticFeedback.impact("medium")

        // Добавляем/обновляем игрока через Server Action
        const { player, error } = await addPlayerToRoom(roomState.id, newPlayer)

        if (error) {
          console.error("handleAddPlayer: Error adding player via Server Action:", error)
          showAlert(`AddPlayer SA error: ${error}`) // Отладочное сообщение
          return
        }
        if (!player) {
          console.error("handleAddPlayer: Server Action returned null player.")
          showAlert("AddPlayer SA returned null.") // Отладочное сообщение
          return
        }

        // Обновляем состояние комнаты после добавления игрока
        const updatedParticipants = [...playersInRoom.filter((p) => p.isParticipant), player].filter(
          Boolean,
        ) as Player[]
        const newTotalTon = updatedParticipants.reduce((sum, p) => sum + p.tonValue, 0)
        const newTotalGifts = updatedParticipants.length
        const newStatus = newTotalGifts === 1 ? "single_player" : newTotalGifts >= 2 ? "countdown" : "waiting"

        await updateRoomState(roomState.id, {
          total_gifts: newTotalGifts,
          total_ton: newTotalTon,
          status: newStatus,
          countdown: newStatus === "countdown" ? 20 : roomState.countdown,
        })
      } catch (error: any) {
        console.error("Exception in handleAddPlayer:", error)
        showAlert(`Exception in AddPlayer: ${error.message}`) // Отладочное сообщение
      }
    },
    [user, roomState, playersInRoom, hapticFeedback, supabase, showAlert], // Добавляем showAlert в зависимости
  )

  const getWheelSegments = () => {
    const participants = playersInRoom.filter((p) => p.isParticipant)
    if (participants.length === 0) return []

    let currentAngle = 0
    return participants.map((player) => {
      const segmentAngle = (player.percentage / 100) * 360
      const segment = {
        player,
        startAngle: currentAngle,
        endAngle: currentAngle + segmentAngle,
        angle: segmentAngle,
      }
      currentAngle += segmentAngle
      return segment
    })
  }

  const segments = getWheelSegments()
  const participants = playersInRoom.filter((p) => p.isParticipant)

  const tonButtonFontSizeClass = displayedTonAmount >= 10 ? "text-xs" : "text-base"

  const formatGiftsText = (count: number) => {
    if (count === 0) return "0 подарков"
    if (count === 1) return "1 подарок"
    if (count >= 2 && count <= 4) return `${count} подарка`
    return `${count} подарков`
  }

  // Эффект для блокировки прокрутки фона при открытом модале игроков
  useEffect(() => {
    if (showPlayersModal) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.body.style.overflow = "" // Очистка при размонтировании
    }
  }, [showPlayersModal])

  // Если Supabase не настроен (local preview) – показываем упрощённый UI без данных из БД
  if (!supabase) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <p>Supabase не настроен. Добавьте переменные окружения или разверните на Vercel.</p>
      </div>
    )
  }

  // Показываем загрузку пока не готов Telegram или комната
  if (!isReady || !roomState) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-black text-white flex items-center justify-center">
        <div className="text-center">
          <p>Загрузка...</p>
        </div>
      </div>
    )
  }

  // ** rest of code here **
}
