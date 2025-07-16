"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Plus, X, Eye, Users } from "lucide-react"
import { useTelegram } from "../hooks/useTelegram"
import type { TelegramUser } from "../types/telegram"
import { createClientComponentClient } from "@/lib/supabase"
import { getOrCreateRoom, addPlayerToRoom, updateRoomState, getPlayersInRoom, ensureUserOnline } from "@/app/actions"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import type { Player } from "@/types/player" // Импортируем Player из нового файла

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
  const { user, isReady, hapticFeedback, getUserPhotoUrl, getUserDisplayName, showAlert } = useTelegram()
  const supabase = createClientComponentClient()

  const defaultRoomId = "default-room-id" // Можно сделать динамическим в будущем

  const [roomState, setRoomState] = useState<RoomState | null>(null)
  const [playersInRoom, setPlayersInRoom] = useState<Player[]>([]) // Все игроки в комнате
  const [rotation, setRotation] = useState(0)
  const [showWinnerModal, setShowWinnerModal] = useState(false)
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
      username: telegramUser.username || null, // username может быть null
      displayName: getUserDisplayName(telegramUser), // Используем getUserDisplayName
      avatar: getUserPhotoUrl(telegramUser) || null, // avatar может быть null
      gifts: isParticipant ? 1 : 0,
      tonValue: tonValue,
      color: isParticipant ? playerColors[existingPlayersCount % playerColors.length] : "#4b5563", // Цвет по умолчанию для наблюдателей
      percentage: 0,
      isParticipant: isParticipant,
    }
  }

  // Инициализация комнаты и подписка на Realtime
  useEffect(() => {
    if (!isReady || !user || !supabase) return // supabase может быть null в локальном превью

    // --- Добавлено логирование объекта user ---
    console.log("[Client] Telegram User object in page.tsx (from useTelegram):", JSON.stringify(user, null, 2))
    // --- Конец добавленного логирования ---

    const initializeRoom = async () => {
      try {
        const { room, error } = await getOrCreateRoom(defaultRoomId)
        if (error) {
          console.error("Room initialization error:", error)
          return
        }
        if (room) {
          setRoomState(room)
        }

        const userAvatar = getUserPhotoUrl(user)
        const userDisplayName = getUserDisplayName(user)

        const { success, error: onlineError } = await ensureUserOnline(
          defaultRoomId,
          user.id,
          user.username,
          userAvatar,
          userDisplayName,
        )

        if (onlineError) {
          console.error("Error ensuring user online:", onlineError)
        } else if (success) {
          const { players, error } = await getPlayersInRoom(defaultRoomId)
          if (!error && players) {
            setPlayersInRoom(players) // Теперь players уже в camelCase
            console.log("[Client] Initial players in room:", JSON.stringify(players, null, 2))
          } else if (error) {
            console.error("Error fetching players:", error)
          }
        }
      } catch (error: any) {
        console.error("Exception in initializeRoom:", error)
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
            return
          }
          setPlayersInRoom(players) // Теперь players уже в camelCase
          console.log("[Client] Players updated via Realtime:", JSON.stringify(players, null, 2))
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(roomSubscription)
      supabase.removeChannel(playerSubscription)
    }
  }, [isReady, user, supabase, getUserPhotoUrl, getUserDisplayName])

  // Дополнительное логирование для отслеживания состояния playersInRoom
  useEffect(() => {
    console.log("[Client] Current playersInRoom state:", JSON.stringify(playersInRoom, null, 2))
  }, [playersInRoom])

  // Heartbeat для поддержания статуса "онлайн"
  useEffect(() => {
    if (!isReady || !user || !supabase || !roomState) return

    const sendHeartbeat = async () => {
      const userAvatar = getUserPhotoUrl(user)
      const userDisplayName = getUserDisplayName(user)
      const { success, error: onlineError } = await ensureUserOnline(
        roomState.id,
        user.id,
        user.username,
        userAvatar,
        userDisplayName,
      )
      if (onlineError) {
        console.error("Heartbeat error:", onlineError)
      }
    }

    // Отправляем "пульс" сразу при загрузке
    sendHeartbeat()

    // Настраиваем интервал для периодической отправки "пульса" (каждые 30 секунд)
    const heartbeatInterval = setInterval(sendHeartbeat, 30 * 1000)

    return () => {
      clearInterval(heartbeatInterval)
    }
  }, [isReady, user, supabase, roomState, getUserPhotoUrl, getUserDisplayName]) // Добавляем roomState в зависимости

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
          return
        }

        if (roomState.status === "countdown" && roomState.countdown <= 3) {
          console.error("handleAddPlayer: Cannot add player during final countdown.")
          return
        }
        if (roomState.status === "spinning" || roomState.status === "finished") {
          console.error("handleAddPlayer: Cannot add player during spinning or finished state.")
          return
        }

        const existingParticipant = playersInRoom.find((p) => p.telegramId === user.id && p.isParticipant)
        if (existingParticipant) {
          hapticFeedback.notification("error")
          console.error("handleAddPlayer: User is already a participant.")
          return
        }

        const tonValue = isGift ? Math.random() * 20 + 5 : tonAmountToAdd!
        const newPlayer = createPlayerObject(user, true, tonValue, playersInRoom.filter((p) => p.isParticipant).length)

        hapticFeedback.impact("medium")

        // Добавляем/обновляем игрока через Server Action
        const { player, error } = await addPlayerToRoom(roomState.id, newPlayer)

        if (error) {
          console.error("handleAddPlayer: Error adding player via Server Action:", error)
          return
        }
        if (!player) {
          console.error("handleAddPlayer: Server Action returned null player.")
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
      }
    },
    [user, roomState, playersInRoom, hapticFeedback, supabase],
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
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-400 mx-auto mb-4"></div>
          <p className="text-gray-400">Подключение к Telegram и загрузка комнаты...</p>
        </div>
      </div>
    )
  }

  const currentWinner = roomState.winner_telegram_id
    ? playersInRoom.find((p) => p.telegramId === roomState.winner_telegram_id)
    : null

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-black text-white relative overflow-hidden">
      {/* Верхние элементы UI: Счетчик игроков и Информация о текущем пользователе */}
      <div className="absolute top-4 left-4 right-4 z-20 flex justify-between items-center gap-2">
        {/* Счетчик игроков в комнате */}
        <Dialog>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="bg-black/60 hover:bg-black/80 border border-gray-600 backdrop-blur-sm text-white h-10 px-4 py-2 rounded-lg flex items-center justify-center"
              onClick={() => hapticFeedback.selection()}
            >
              <Eye className="w-4 h-4 mr-2" />
              <span className="text-sm whitespace-nowrap">Онлайн: {playersInRoom.length}</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-black/90 border-gray-600 rounded-2xl max-w-md w-full max-h-[70vh] flex flex-col">
            <DialogHeader className="flex items-center justify-between p-4 border-b border-gray-600 flex-shrink-0 flex-row">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-green-400" />
                <DialogTitle className="text-lg font-bold text-white">Онлайн</DialogTitle>
              </div>
              {/* Кнопка закрытия уже встроена в DialogContent */}
            </DialogHeader>
            <div className="flex-1 overflow-y-auto p-4">
              {playersInRoom.length === 0 ? (
                <p className="text-gray-400 text-center py-4">В комнате пока нет игроков.</p>
              ) : (
                <div className="space-y-2">
                  {playersInRoom.map((player) => {
                    // Добавляем логирование прямо перед рендерингом
                    console.log(
                      `[Client] Rendering player in Online modal: id=${player.id}, displayName='${player.displayName}', username='${player.username}', avatar='${player.avatar}'`,
                    )
                    return (
                      <div
                        key={player.id}
                        className={`flex items-center gap-3 p-2 rounded-lg ${
                          player.isParticipant ? "bg-gray-800/50" : "bg-gray-800/30"
                        }`}
                      >
                        {/* Индикатор онлайн */}
                        <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0"></div>
                        <img
                          src={player.avatar || "/placeholder.svg"}
                          alt="Player"
                          className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                          style={{ border: player.isParticipant ? `2px solid ${player.color}` : "2px solid #4b5563" }}
                        />
                        <div className="flex-1">
                          {/* Теперь player.displayName должен быть корректным */}
                          <span className="text-white font-bold text-lg">{player.displayName}</span>
                          {/* Удаляем отображение tonValue и percentage из этого модального окна */}
                          {/* {player.isParticipant && (
                        <div className="text-xs text-gray-400">
                          {player.tonValue.toFixed(1)} ТОН • {player.percentage.toFixed(1)}%
                        </div>
                      )} */}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Информация о текущем пользователе */}
        {user && (
          <div className="bg-black/60 border border-gray-600 backdrop-blur-sm rounded-lg px-3 py-2 flex items-center gap-2 h-10">
            <img src={getUserPhotoUrl(user) || "/placeholder.svg"} alt="Avatar" className="w-6 h-6 rounded-full" />
            <span className="text-sm text-white whitespace-nowrap">{getUserDisplayName(user)}</span>
          </div>
        )}
      </div>

      {/* Общий банк */}
      <div className="flex items-center justify-center mb-4 pt-16 relative z-10">
        <div className="flex items-center gap-2 text-green-400">
          <div className="w-2 h-2 bg-green-400 rounded-full flex-shrink-0"></div>
          <span className="text-lg font-medium">Общий банк</span>
        </div>
      </div>

      {/* Счетчик подарков и ТОН */}
      <div className="flex justify-center mb-8 relative z-10">
        <div className="border border-gray-600 px-6 py-3 rounded-xl font-medium text-lg">
          {formatGiftsText(roomState.total_gifts)} | {(roomState.total_ton ?? 0).toFixed(1)} ТОН
        </div>
      </div>

      {/* Колесо рулетки и указатель */}
      <div className="flex justify-center items-center mb-8 relative px-4">
        {/* Указатель */}
        <div className="absolute top-[-15px] left-1/2 -translate-x-1/2 z-30 transform rotate-180">
          <div className="w-0 h-0 border-l-[10px] border-r-[10px] border-b-[15px] border-l-transparent border-r-transparent border-b-green-500"></div>
        </div>

        {/* Колесо */}
        <div
          className="w-80 h-80 min-w-80 min-h-80 max-w-80 max-h-80 rounded-full relative shadow-2xl shadow-gray-900/50"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: roomState.status === "spinning" ? "transform 15s cubic-bezier(0.25, 0.1, 0.25, 1)" : "none",
          }}
        >
          {roomState.status === "waiting" ? (
            <div className="w-full h-full bg-gray-600 rounded-full relative">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 bg-black rounded-full flex items-center justify-center border-0">
                <span className="text-gray-300 text-sm font-medium">Ожидание</span>
              </div>
            </div>
          ) : participants.length === 1 && roomState.status === "single_player" ? (
            <div className="w-full h-full rounded-full relative" style={{ backgroundColor: participants[0]?.color }}>
              <div className="absolute top-16 left-16 w-8 h-8 rounded-full overflow-hidden border-2 border-white">
                <img
                  src={participants[0]?.avatar || "/placeholder.svg"}
                  alt="Player"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 bg-black rounded-full flex items-center justify-center border-0">
                <span className="text-gray-300 text-sm font-medium">Ожидание</span>
              </div>
            </div>
          ) : (
            <>
              <svg className="w-full h-full" viewBox="0 0 200 200">
                {segments.map((segment, index) => {
                  const startAngleRad = (segment.startAngle * Math.PI) / 180
                  const endAngleRad = (segment.endAngle * Math.PI) / 180
                  const largeArcFlag = segment.angle > 180 ? 1 : 0

                  const x1 = 100 + 100 * Math.cos(startAngleRad)
                  const y1 = 100 + 100 * Math.sin(startAngleRad)
                  const x2 = 100 + 100 * Math.cos(endAngleRad)
                  const y2 = 100 + 100 * Math.sin(endAngleRad)

                  const pathData = [
                    `M 100 100`,
                    `L ${x1} ${y1}`,
                    `A 100 100 0 ${largeArcFlag} 1 ${x2} ${y2}`,
                    "Z",
                  ].join(" ")

                  const midAngle = (segment.startAngle + segment.endAngle) / 2
                  const midAngleRad = (midAngle * Math.PI) / 180
                  const avatarX = 100 + 70 * Math.cos(midAngleRad)
                  const avatarY = 100 + 70 * Math.sin(midAngleRad)

                  return (
                    <g key={index}>
                      <path d={pathData} fill={segment.player.color} />
                      <circle
                        cx={avatarX}
                        cy={avatarY}
                        r="8"
                        fill="white"
                        stroke={segment.player.color}
                        strokeWidth="2"
                      />
                      <image
                        x={avatarX - 8}
                        y={avatarY - 8}
                        width="16"
                        height="16"
                        href={segment.player.avatar || "/placeholder.svg"}
                        clipPath="circle(8px at center)"
                      />
                    </g>
                  )
                })}
              </svg>

              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 bg-black rounded-full flex items-center justify-center border-0">
                {roomState.status === "countdown" ? (
                  <span className="text-gray-300 text-lg font-mono">
                    {String(Math.floor(roomState.countdown / 60)).padStart(2, "0")}:
                    {String(roomState.countdown % 60).padStart(2, "0")}
                  </span>
                ) : (
                  <span className="text-gray-300 text-sm font-medium">
                    {roomState.status === "spinning" ? "Крутим!" : "Ожидание"}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Кнопки действий */}
      <div className="flex gap-3 px-4 mb-6 relative z-10">
        <Button
          className="flex-1 bg-green-500 hover:bg-green-600 text-black font-medium py-3 rounded-xl disabled:bg-gray-600 disabled:text-gray-400"
          onClick={() => handleAddPlayer(true)}
          disabled={
            roomState.status === "spinning" ||
            roomState.status === "finished" ||
            (roomState.status === "countdown" && roomState.countdown <= 3)
          }
        >
          <Plus className="w-5 h-5 mr-2" />
          Добавить гифт
        </Button>

        <Button
          className={`flex-1 font-medium py-3 rounded-xl flex items-center justify-center ${
            roomState.status === "countdown" && roomState.countdown <= 3
              ? "bg-gray-600 text-gray-400 cursor-not-allowed"
              : "bg-green-400 hover:bg-green-500 text-black"
          }`}
          onClick={() => {
            handleAddPlayer(false, displayedTonAmount)
            setDisplayedTonAmount(Math.floor(Math.random() * 20 + 5))
          }}
          disabled={
            roomState.status === "spinning" ||
            roomState.status === "finished" ||
            (roomState.status === "countdown" && roomState.countdown <= 3)
          }
        >
          <span className="text-2xl mr-2 flex-shrink-0">🎁</span>
          <span className={`whitespace-nowrap ${tonButtonFontSizeClass}`}>Добавить {displayedTonAmount} ТОН</span>
        </Button>
      </div>

      {/* Эмодзи */}
      <div className="flex justify-center gap-4 mb-6 relative z-10">
        {items.map((item, index) => (
          <Button
            key={index}
            variant="ghost"
            className="flex flex-col items-center gap-1 text-gray-400 hover:text-white py-3"
            onClick={() => hapticFeedback.selection()}
          >
            <span className="text-lg">{item.icon}</span>
            <span className="text-xs">{item.label}</span>
          </Button>
        ))}
      </div>

      {/* Список игроков */}
      <div className="px-4 mb-6 relative z-10">
        {participants.length === 0 ? (
          <Card className="bg-black/60 border-gray-600 p-4 backdrop-blur-sm text-center mb-4">
            <p className="text-gray-400">Нет участников</p>
          </Card>
        ) : (
          participants.map((player, index) => (
            <div key={player.id} className="mb-3">
              <Card className="bg-black/60 border-gray-600 p-4 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img
                      src={player.avatar || "/placeholder.svg"}
                      alt="Player"
                      className="w-8 h-8 rounded-full object-cover"
                      style={{ border: `2px solid ${player.color}` }}
                    />
                    <div>
                      <span className="text-white font-medium">{player.displayName}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <span className="bg-white text-black px-3 py-1 rounded-full text-sm font-medium">
                      {player.percentage.toFixed(player.percentage < 10 ? 2 : 0)}%
                    </span>
                    <span className="bg-gray-600 text-white px-3 py-1 rounded-full text-sm">
                      {player.tonValue.toFixed(1)} ТОН
                    </span>
                  </div>
                </div>
              </Card>
            </div>
          ))
        )}
      </div>

      {/* Модал победителя */}
      {showWinnerModal && currentWinner && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <Card className="bg-black border-gray-600 p-6 rounded-2xl max-w-sm w-full text-center relative">
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 text-gray-400 hover:text-white"
              onClick={() => setShowWinnerModal(false)}
            >
              <X className="w-4 h-4" />
            </Button>
            <div className="text-4xl mb-4">🎉</div>
            <h2 className="text-2xl font-bold text-white mb-2">Победитель!</h2>
            <img
              src={currentWinner.avatar || "/placeholder.svg"}
              alt="Winner"
              className="w-16 h-16 rounded-full mx-auto mb-2 object-cover"
            />
            <div className="text-lg text-white mb-2 flex items-center justify-center gap-1">
              {currentWinner.displayName}
            </div>
            <div className="text-sm text-gray-400 mb-4">Выиграл {(roomState.total_ton ?? 0).toFixed(1)} ТОН</div>
            <div className="text-xs text-gray-500">Шанс победы: {currentWinner.percentage.toFixed(1)}%</div>
          </Card>
        </div>
      )}

      {/* Нижняя навигация */}
      <div className="fixed left-0 right-0 bottom-0 bg-black/80 backdrop-blur-sm border-t border-gray-700 z-50">
        <div className="flex justify-around py-2">
          {items.map((item, index) => (
            <Button
              key={index}
              variant="ghost"
              className="flex flex-col items-center gap-1 text-gray-400 hover:text-white py-3"
              onClick={() => hapticFeedback.selection()}
            >
              <span className="text-lg">{item.icon}</span>
              <span className="text-xs">{item.label}</span>
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
