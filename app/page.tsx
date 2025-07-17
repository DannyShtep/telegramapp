"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Plus, X, Eye, Users, AlertCircle } from "lucide-react"
import { useTelegram } from "../hooks/useTelegram"
import type { TelegramUser } from "../types/telegram"
import { createClientComponentClient } from "@/lib/supabase"
import {
  getOrCreateRoom,
  addPlayerToRoom,
  updateRoomState,
  getPlayersInRoom,
  ensureUserOnline,
  determineWinnerAndSpin,
  resetRoom,
  getParticipants,
} from "@/app/actions"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import type { Player } from "@/types/player"

interface RoomState {
  id: string
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

  const defaultRoomId = "default-room-id"

  const [roomState, setRoomState] = useState<RoomState | null>(null)
  const [playersInRoom, setPlayersInRoom] = useState<Player[]>([])
  const [participantsForGame, setParticipantsForGame] = useState<Player[]>([])
  const [rotation, setRotation] = useState(0)
  const [showWinnerModal, setShowWinnerModal] = useState(false)
  const [winnerDetails, setWinnerDetails] = useState<Player | null>(null)
  const [displayedTonAmount, setDisplayedTonAmount] = useState(Math.floor(Math.random() * 20 + 5))
  const [spinTrigger, setSpinTrigger] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCountdownSpinning, setIsCountdownSpinning] = useState(false)

  const playerColors = ["#ef4444", "#22c55e", "#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899"]
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const onlineUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Функция для обработки ошибок
  const handleError = useCallback(
    (error: string, context: string) => {
      console.error(`[${context}] Error:`, error)
      setError(error)
      setIsLoading(false)
      hapticFeedback.notification("error")
      setTimeout(() => setError(null), 5000)
    },
    [hapticFeedback],
  )

  // Функция для создания объекта игрока из TelegramUser
  const createPlayerObject = useCallback(
    (telegramUser: TelegramUser, isParticipant: boolean, tonValue = 0, existingPlayersCount = 0): Player => {
      return {
        id: `temp_${telegramUser.id}_${Date.now()}`,
        telegramId: telegramUser.id,
        username: telegramUser.username || null,
        displayName: getUserDisplayName(telegramUser),
        avatar: getUserPhotoUrl(telegramUser) || null,
        gifts: isParticipant ? 1 : 0,
        tonValue: tonValue,
        color: isParticipant ? playerColors[existingPlayersCount % playerColors.length] : "#4b5563",
        percentage: 0,
        isParticipant: isParticipant,
      }
    },
    [getUserDisplayName, getUserPhotoUrl, playerColors],
  )

  // Функция для обновления онлайн-статуса каждую секунду
  const updateOnlineStatus = useCallback(async () => {
    if (!user || !roomState) return

    try {
      const userAvatar = getUserPhotoUrl(user)
      const userDisplayName = getUserDisplayName(user)
      await ensureUserOnline(roomState.id, user.id, user.username, userAvatar, userDisplayName)
    } catch (error: any) {
      console.warn("Online status update failed:", error.message)
    }
  }, [user, roomState, getUserPhotoUrl, getUserDisplayName])

  // Инициализация комнаты и подписка на Realtime
  useEffect(() => {
    if (!isReady || !user || !supabase) return

    console.log("[Client] Initializing room for user:", JSON.stringify(user, null, 2))

    const initializeRoom = async () => {
      try {
        setIsLoading(true)
        setError(null)

        const { room, error: roomError } = await getOrCreateRoom(defaultRoomId)
        if (roomError) {
          handleError(roomError, "Room Initialization")
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
          handleError(onlineError, "User Online Status")
        }

        // Загружаем начальные данные
        const [playersResult, participantsResult] = await Promise.all([
          getPlayersInRoom(defaultRoomId),
          getParticipants(defaultRoomId),
        ])

        if (playersResult.error) {
          handleError(playersResult.error, "Fetching Players")
        } else if (playersResult.players) {
          setPlayersInRoom(playersResult.players)
        }

        if (participantsResult.error) {
          handleError(participantsResult.error, "Fetching Participants")
        } else if (participantsResult.participants) {
          setParticipantsForGame(participantsResult.participants)
        }
      } catch (error: any) {
        handleError(error.message, "Room Initialization Exception")
      } finally {
        setIsLoading(false)
      }
    }

    initializeRoom()

    // Подписки на Realtime изменения
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

    const playerSubscription = supabase
      .channel(`players_in_room:${defaultRoomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `room_id=eq.${defaultRoomId}` },
        async () => {
          try {
            const [playersResult, participantsResult] = await Promise.all([
              getPlayersInRoom(defaultRoomId),
              getParticipants(defaultRoomId),
            ])

            if (playersResult.players) {
              setPlayersInRoom(playersResult.players)
            }
            if (participantsResult.participants) {
              setParticipantsForGame(participantsResult.participants)
            }
          } catch (error: any) {
            console.error("Realtime Update Error:", error.message)
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(roomSubscription)
      supabase.removeChannel(playerSubscription)
    }
  }, [isReady, user, supabase])

  // Обновление онлайн-статуса каждую секунду
  useEffect(() => {
    if (!isReady || !user || !supabase || !roomState) return

    // Первоначальное обновление
    updateOnlineStatus()

    // Устанавливаем интервал для обновления каждую секунду
    onlineUpdateIntervalRef.current = setInterval(updateOnlineStatus, 1000)

    return () => {
      if (onlineUpdateIntervalRef.current) {
        clearInterval(onlineUpdateIntervalRef.current)
        onlineUpdateIntervalRef.current = null
      }
    }
  }, [isReady, user, supabase, roomState, updateOnlineStatus])

  // Логика игры и таймера
  useEffect(() => {
    if (!roomState) return

    const currentParticipants = participantsForGame
    const totalTon = currentParticipants.reduce((sum, p) => sum + p.tonValue, 0)

    // Пересчитываем проценты
    const updatedParticipantsForGame = currentParticipants.map((p) => {
      const newPerc = totalTon > 0 ? (p.tonValue / totalTon) * 100 : 0
      return newPerc !== p.percentage ? { ...p, percentage: newPerc } : p
    })

    const hasParticipantsChanged = updatedParticipantsForGame.some((p, i) => p !== participantsForGame[i])
    if (hasParticipantsChanged) {
      setParticipantsForGame(updatedParticipantsForGame)
    }

    // Логика анимации колеса во время обратного отсчета
    if (roomState.status === "countdown") {
      if (!isCountdownSpinning) {
        setIsCountdownSpinning(true)
        // Запускаем медленное вращение колеса во время обратного отсчета
        const countdownSpinInterval = setInterval(() => {
          setRotation((prev) => prev + 2) // Медленное вращение на 2 градуса каждые 50мс
        }, 50)

        // Сохраняем интервал для очистки
        const cleanup = () => {
          clearInterval(countdownSpinInterval)
          setIsCountdownSpinning(false)
        }

        // Очищаем при смене статуса
        const statusCheckInterval = setInterval(() => {
          if (roomState.status !== "countdown") {
            cleanup()
            clearInterval(statusCheckInterval)
          }
        }, 100)
      }
    } else {
      setIsCountdownSpinning(false)
    }

    // Логика таймера - запускается только в состоянии countdown с правильным отсчетом 20 секунд
    if (roomState.status === "countdown" && roomState.countdown > 0) {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)

      countdownIntervalRef.current = setInterval(async () => {
        try {
          // Используем текущее значение roomState.countdown, которое обновляется через Realtime
          const currentCountdownValue = roomState.countdown // Захватываем значение из текущего roomState

          if (currentCountdownValue <= 0) {
            clearInterval(countdownIntervalRef.current!)
            countdownIntervalRef.current = null
            setIsCountdownSpinning(false)
            hapticFeedback.impact("heavy")

            // Запускаем определение победителя и вращение
            await determineWinnerAndSpin(defaultRoomId)
            return
          }

          const newCountdown = currentCountdownValue - 1
          if (newCountdown <= 3 && newCountdown > 0) {
            hapticFeedback.impact("heavy")
          }

          // Обновляем только countdown, не меняя статус
          await updateRoomState(defaultRoomId, { countdown: newCountdown })
        } catch (error: any) {
          handleError(error.message, "Countdown Timer")
          clearInterval(countdownIntervalRef.current!)
          countdownIntervalRef.current = null
          setIsCountdownSpinning(false)
        }
      }, 1000)
    } else if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = null
    }

    // Обработка финального вращения колеса
    if (roomState.status === "spinning" && spinTrigger === 0) {
      setIsCountdownSpinning(false)
      const randomRotation = 5400 + Math.random() * 1440
      setRotation((prev) => prev + randomRotation)
      setSpinTrigger(1)

      setTimeout(async () => {
        try {
          const winner = updatedParticipantsForGame.find((p) => p.telegramId === roomState.winner_telegram_id)
          if (winner) {
            setWinnerDetails(winner)
            setShowWinnerModal(true)
            hapticFeedback.notification("success")

            setTimeout(async () => {
              setShowWinnerModal(false)
              await resetRoom(defaultRoomId)
              setSpinTrigger(0)
              setRotation(0) // Сбрасываем вращение
            }, 4000)
          } else {
            await resetRoom(defaultRoomId)
            setSpinTrigger(0)
            setRotation(0) // Сбрасываем вращение
          }
        } catch (error: any) {
          handleError(error.message, "Spin Completion")
        }
      }, 15000)
    } else if (roomState.status !== "spinning" && spinTrigger !== 0) {
      setSpinTrigger(0)
    }

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current)
        countdownIntervalRef.current = null
      }
    }
  }, [roomState, participantsForGame, spinTrigger, isCountdownSpinning, defaultRoomId, hapticFeedback, handleError])

  const handleAddPlayer = useCallback(
    async (isGift = true, tonAmountToAdd?: number) => {
      console.log("[Client] handleAddPlayer called", { isGift, tonAmountToAdd, isLoading })

      if (isLoading) {
        console.log("[Client] Already loading, skipping")
        return
      }

      try {
        if (!user || !roomState || !supabase) {
          handleError("Отсутствуют необходимые данные", "Add Player")
          return
        }

        if (roomState.status === "spinning" || roomState.status === "finished") {
          showAlert("Игра уже идет или завершена. Дождитесь нового раунда.")
          hapticFeedback.notification("error")
          return
        }

        if (roomState.status === "countdown" && roomState.countdown <= 3) {
          showAlert("Нельзя присоединиться в последние секунды отсчета.")
          hapticFeedback.notification("error")
          return
        }

        console.log("[Client] Setting loading to true")
        setIsLoading(true)
        setError(null)

        // Получаем текущего участника, если он есть
        const existingParticipant = participantsForGame.find((p) => p.telegramId === user.id)
        const currentTonValue = existingParticipant ? existingParticipant.tonValue : 0
        const currentGifts = existingParticipant ? existingParticipant.gifts : 0

        const tonValueToAdd = isGift ? Math.random() * 20 + 5 : tonAmountToAdd!
        const newTonValue = currentTonValue + tonValueToAdd
        const newGifts = currentGifts + 1

        const newPlayer = createPlayerObject(user, true, newTonValue, participantsForGame.length)
        newPlayer.gifts = newGifts

        console.log("[Client] Created player object:", newPlayer)

        hapticFeedback.impact("medium")

        // Добавляем игрока - server action сам обновит состояние комнаты
        console.log("[Client] Calling addPlayerToRoom")
        const { player, error } = await addPlayerToRoom(roomState.id, newPlayer)

        console.log("[Client] addPlayerToRoom result:", { player, error })

        if (error) {
          handleError(error, "Add Player to Room")
          return
        }

        if (!player) {
          handleError("Не удалось добавить игрока", "Add Player")
          return
        }

        console.log("[Client] Player added successfully")
        // Realtime подписки автоматически обновят UI
      } catch (error: any) {
        console.error("[Client] Exception in handleAddPlayer:", error)
        handleError(error.message, "Add Player Exception")
      } finally {
        console.log("[Client] Setting loading to false")
        setIsLoading(false)
      }
    },
    [
      user,
      roomState,
      supabase,
      isLoading,
      hapticFeedback,
      showAlert,
      createPlayerObject,
      participantsForGame,
      handleError,
    ],
  )

  const getWheelSegments = useCallback(() => {
    const currentParticipants = participantsForGame
    if (currentParticipants.length === 0) return []

    let currentAngle = 0
    return currentParticipants.map((player) => {
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
  }, [participantsForGame])

  const segments = getWheelSegments()
  const participants = participantsForGame

  const tonButtonFontSizeClass = displayedTonAmount >= 10 ? "text-xs" : "text-base"

  const formatGiftsText = useCallback((count: number) => {
    if (count === 0) return "0 подарков"
    if (count === 1) return "1 подарок"
    if (count >= 2 && count <= 4) return `${count} подарка`
    return `${count} подарков`
  }, [])

  // Показываем сообщение если Supabase не настроен
  if (!supabase) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white p-4">
        <Card className="bg-gray-900 border-gray-700 p-6 text-center">
          <AlertCircle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Конфигурация не найдена</h2>
          <p className="text-gray-400">Supabase не настроен. Добавьте переменные окружения или разверните на Vercel.</p>
        </Card>
      </div>
    )
  }

  // Показываем загрузку только при первоначальной инициализации
  if (!isReady || !roomState) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-400 mx-auto mb-4"></div>
          <p className="text-gray-400">{!isReady ? "Подключение к Telegram..." : "Загрузка игры..."}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-black text-white relative overflow-hidden touch-manipulation">
      {/* Уведомление об ошибке */}
      {error && (
        <div className="fixed top-4 left-4 right-4 z-50">
          <Alert className="bg-red-900/90 border-red-700 backdrop-blur-sm">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-white">{error}</AlertDescription>
          </Alert>
        </div>
      )}

      {/* Индикатор загрузки для действий */}
      {isLoading && (
        <div className="fixed top-20 left-4 right-4 z-50">
          <Alert className="bg-blue-900/90 border-blue-700 backdrop-blur-sm">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400"></div>
            <AlertDescription className="text-white ml-2">Обработка запроса...</AlertDescription>
          </Alert>
        </div>
      )}

      {/* Верхние элементы UI */}
      <div className="absolute top-4 left-4 right-4 z-20 flex justify-between items-center gap-2">
        {/* Счетчик игроков в комнате - ТОЛЬКО СПИСОК ОНЛАЙН ИГРОКОВ */}
        <Dialog>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="bg-black/60 hover:bg-black/80 border border-gray-600 backdrop-blur-sm text-white h-10 px-4 py-2 rounded-lg flex items-center justify-center touch-manipulation"
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
                <DialogTitle className="text-lg font-bold text-white">Онлайн игроки</DialogTitle>
              </div>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto p-4">
              {playersInRoom.length === 0 ? (
                <p className="text-gray-400 text-center py-4">В комнате пока нет игроков.</p>
              ) : (
                <div className="space-y-2">
                  {playersInRoom.map((player) => (
                    <div
                      key={player.id}
                      className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
                        player.isParticipant ? "bg-gray-800/50" : "bg-gray-800/30"
                      }`}
                    >
                      <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0 animate-pulse"></div>
                      <img
                        src={player.avatar || "/placeholder.svg"}
                        alt="Player"
                        className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                        style={{ border: player.isParticipant ? `2px solid ${player.color}` : "2px solid #4b5563" }}
                      />
                      <div className="flex-1">
                        <span className="text-white font-medium">{player.displayName}</span>
                        {player.isParticipant && <div className="text-xs text-green-400">Участвует в игре</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Информация о текущем пользователе */}
        {user && (
          <div className="bg-black/60 border border-gray-600 backdrop-blur-sm rounded-lg px-3 py-2 flex items-center gap-2 h-10">
            <img
              src={getUserPhotoUrl(user) || "/placeholder.svg"}
              alt="Avatar"
              className="w-6 h-6 rounded-full object-cover"
            />
            <span className="text-sm text-white whitespace-nowrap">{getUserDisplayName(user)}</span>
          </div>
        )}
      </div>

      {/* Общий банк */}
      <div className="flex items-center justify-center mb-4 pt-16 relative z-10">
        <div className="flex items-center gap-2 text-green-400">
          <div className="w-2 h-2 bg-green-400 rounded-full flex-shrink-0 animate-pulse"></div>
          <span className="text-lg font-medium">Общий банк</span>
        </div>
      </div>

      {/* Счетчик подарков и ТОН */}
      <div className="flex justify-center mb-8 relative z-10">
        <div className="border border-gray-600 px-6 py-3 rounded-xl font-medium text-lg bg-black/20 backdrop-blur-sm">
          {formatGiftsText(roomState.total_gifts)} | {(roomState.total_ton ?? 0).toFixed(1)} ТОН
        </div>
      </div>

      {/* Колесо рулетки и указатель */}
      <div className="flex justify-center items-center mb-8 relative px-4">
        {/* Указатель */}
        <div className="absolute top-[-15px] left-1/2 -translate-x-1/2 z-30 transform rotate-180">
          <div className="w-0 h-0 border-l-[10px] border-r-[10px] border-b-[15px] border-l-transparent border-r-transparent border-b-green-500 drop-shadow-lg"></div>
        </div>

        {/* Колесо */}
        <div
          className="w-80 h-80 min-w-80 min-h-80 max-w-80 max-h-80 rounded-full relative shadow-2xl shadow-gray-900/50 wheel-container wheel-spin"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: roomState.status === "spinning" ? "transform 15s cubic-bezier(0.25, 0.1, 0.25, 1)" : "none",
          }}
        >
          {roomState.status === "waiting" ? (
            <div className="w-full h-full bg-gray-600 rounded-full relative">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 bg-black rounded-full flex items-center justify-center border-0">
                <span className="text-gray-300 text-sm font-medium">Ожидание игроков</span>
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
                <span className="text-gray-300 text-sm font-medium">Ждем второго игрока</span>
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
                  <span className="text-green-400 text-lg font-mono font-bold">{roomState.countdown}</span>
                ) : (
                  <span className="text-gray-300 text-sm font-medium">
                    {roomState.status === "spinning" ? "Крутим!" : "Готов к игре"}
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
          className="flex-1 bg-green-500 hover:bg-green-600 text-black font-medium py-3 rounded-xl disabled:bg-gray-600 disabled:text-gray-400 touch-manipulation transition-all duration-200"
          onClick={() => handleAddPlayer(true)}
          disabled={
            isLoading ||
            roomState.status === "spinning" ||
            roomState.status === "finished" ||
            (roomState.status === "countdown" && roomState.countdown <= 3)
          }
        >
          <Plus className="w-5 h-5 mr-2" />
          {isLoading ? "Добавляем..." : "Добавить гифт"}
        </Button>

        <Button
          className={`flex-1 font-medium py-3 rounded-xl flex items-center justify-center touch-manipulation transition-all duration-200 ${
            isLoading || (roomState.status === "countdown" && roomState.countdown <= 3)
              ? "bg-gray-600 text-gray-400 cursor-not-allowed"
              : "bg-green-400 hover:bg-green-500 text-black"
          }`}
          onClick={() => {
            handleAddPlayer(false, displayedTonAmount)
            setDisplayedTonAmount(Math.floor(Math.random() * 20 + 5))
          }}
          disabled={
            isLoading ||
            roomState.status === "spinning" ||
            roomState.status === "finished" ||
            (roomState.status === "countdown" && roomState.countdown <= 3)
          }
        >
          <span className="text-2xl mr-2 flex-shrink-0">🎁</span>
          <span className={`whitespace-nowrap ${tonButtonFontSizeClass}`}>
            {isLoading ? "Добавляем..." : `Добавить ${displayedTonAmount} ТОН`}
          </span>
        </Button>
      </div>

      {/* Навигационные иконки */}
      <div className="flex justify-center gap-4 mb-6 relative z-10">
        {items.map((item, index) => (
          <Button
            key={index}
            variant="ghost"
            className="flex flex-col items-center gap-1 text-gray-400 hover:text-white py-3 touch-manipulation transition-colors duration-200"
            onClick={() => hapticFeedback.selection()}
          >
            <span className="text-lg">{item.icon}</span>
            <span className="text-xs">{item.label}</span>
          </Button>
        ))}
      </div>

      {/* Список участников игры с их ставками */}
      <div className="px-4 mb-6 relative z-10 mobile-safe-area">
        {participants.length === 0 ? (
          <Card className="bg-black/60 border-gray-600 p-4 backdrop-blur-sm text-center mb-4">
            <p className="text-gray-400">Нет участников в текущей игре</p>
            <p className="text-gray-500 text-sm mt-2">Добавьте ТОН, чтобы начать игру!</p>
          </Card>
        ) : (
          <>
            <div className="text-center mb-4">
              <h3 className="text-lg font-bold text-white">Участники игры</h3>
              <p className="text-sm text-gray-400">Ставки обновляются в реальном времени</p>
            </div>
            {participants.map((player) => (
              <div key={player.id} className="mb-3">
                <Card className="bg-black/60 border-gray-600 p-4 backdrop-blur-sm transition-all duration-200 hover:bg-black/70">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <img
                        src={player.avatar || "/placeholder.svg"}
                        alt="Player"
                        className="w-10 h-10 rounded-full object-cover"
                        style={{ border: `3px solid ${player.color}` }}
                      />
                      <div>
                        <span className="text-white font-medium">{player.displayName}</span>
                        {player.gifts > 1 && <div className="text-xs text-gray-400">{player.gifts} подарков</div>}
                      </div>
                    </div>
                    <div className="flex gap-2 items-center">
                      <div className="text-right">
                        <div className="bg-white text-black px-3 py-1 rounded-full text-sm font-bold">
                          {player.percentage.toFixed(player.percentage < 10 ? 2 : 0)}%
                        </div>
                        <div className="text-xs text-gray-400 mt-1">шанс победы</div>
                      </div>
                      <div className="text-right">
                        <div className="bg-green-600 text-white px-3 py-1 rounded-full text-sm font-bold">
                          {player.tonValue.toFixed(1)} ТОН
                        </div>
                        <div className="text-xs text-gray-400 mt-1">ставка</div>
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Модал победителя */}
      {showWinnerModal && winnerDetails && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <Card className="bg-black border-gray-600 p-6 rounded-2xl max-w-sm w-full text-center relative animate-in zoom-in-95 duration-300">
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 text-gray-400 hover:text-white touch-manipulation"
              onClick={() => setShowWinnerModal(false)}
            >
              <X className="w-4 h-4" />
            </Button>
            <div className="text-4xl mb-4 animate-bounce">🎉</div>
            <h2 className="text-2xl font-bold text-white mb-2">Поздравляем!</h2>
            <img
              src={winnerDetails.avatar || "/placeholder.svg"}
              alt="Winner"
              className="w-16 h-16 rounded-full mx-auto mb-2 object-cover border-4 border-green-400"
            />
            <div className="text-lg text-white mb-2 flex items-center justify-center gap-1">
              {winnerDetails.displayName}
            </div>
            <div className="text-sm text-gray-400 mb-4">Выиграл {(roomState.total_ton ?? 0).toFixed(1)} ТОН</div>
            <div className="text-xs text-gray-500">Шанс победы: {winnerDetails.percentage.toFixed(1)}%</div>
          </Card>
        </div>
      )}
    </div>
  )
}
