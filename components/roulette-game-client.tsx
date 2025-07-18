"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react" // Add useMemo
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Plus, X, Eye, Users, AlertCircle } from "lucide-react"
import { useTelegram } from "../hooks/useTelegram"
import type { TelegramUser } from "../types/telegram"
import { createClientComponentClient } from "@/lib/supabase"
import {
  addPlayerToRoom,
  getPlayersInRoom,
  ensureUserOnline,
  determineWinnerAndSpin,
  resetRoom,
  getParticipants,
} from "@/app/actions"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import type { Player } from "@/types/player"

// Интерфейс для данных комнаты, включая новое поле countdown_end_time
interface RoomState {
  id: string
  status: "waiting" | "single_player" | "countdown" | "spinning" | "finished"
  countdown: number // Это поле будет игнорироваться в пользу countdown_end_time на клиенте
  countdown_end_time: string | null // Новое поле для точного отсчета
  winner_telegram_id: number | null
  total_gifts: number
  total_ton: number
}

interface RouletteGameClientProps {
  initialRoomState: RoomState | null
  initialPlayersInRoom: Player[]
  initialParticipantsForGame: Player[]
  initialError: string | null
  defaultRoomId: string
}

const items = [
  { icon: "💝", label: "PvP" },
  { icon: "🔔", label: "Rolls" },
  { icon: "👤", label: "Мои гифты" },
  { icon: "🏪", label: "Магазин" },
  { icon: "⚡", label: "Заработок" },
]

export default function RouletteGameClient({
  initialRoomState,
  initialPlayersInRoom,
  initialParticipantsForGame,
  initialError,
  defaultRoomId,
}: RouletteGameClientProps) {
  const { user, isReady, hapticFeedback, getUserPhotoUrl, getUserDisplayName, showAlert } = useTelegram()
  const supabase = createClientComponentClient()

  const [roomState, setRoomState] = useState<RoomState | null>(initialRoomState)
  const [playersInRoom, setPlayersInRoom] = useState<Player[]>(initialPlayersInRoom)
  const [participantsForGame, setParticipantsForGame] = useState<Player[]>(initialParticipantsForGame)
  const [rotation, setRotation] = useState(0)
  const [showWinnerModal, setShowWinnerModal] = useState(false)
  const [winnerDetails, setWinnerDetails] = useState<Player | null>(null)
  const [displayedTonAmount, setDisplayedTonAmount] = useState(Math.floor(Math.random() * 20 + 5))
  const [spinTrigger, setSpinTrigger] = useState(0) // 0: ready, 1: spinning triggered, 2: spin complete
  const [isAddingPlayer, setIsAddingPlayer] = useState(false) // Новое состояние для кнопки "Добавить"
  const [error, setError] = useState<string | null>(initialError)
  const [countdownSeconds, setCountdownSeconds] = useState(0)

  const playerColors = ["#ef4444", "#22c55e", "#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899"]
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const countdownSpinIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const onlineUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Ref для хранения актуального roomState без добавления его в зависимости useEffect
  const roomStateRef = useRef(roomState)
  useEffect(() => {
    roomStateRef.current = roomState
  }, [roomState])

  // Ref для хранения актуального participantsForGame
  const participantsForGameRef = useRef(participantsForGame)
  useEffect(() => {
    participantsForGameRef.current = participantsForGame
  }, [participantsForGame])

  // Функция для обработки ошибок
  const handleError = useCallback(
    (message: string, context: string) => {
      console.error(`[${context}] Error:`, message)
      setError(message)
      setIsAddingPlayer(false) // Сбрасываем состояние загрузки
      hapticFeedback.notificationOccurred("error")
      setTimeout(() => setError(null), 5000)
    },
    [hapticFeedback],
  )

  // Функция для создания объекта игрока из TelegramUser
  const createPlayerObject = useCallback(
    (telegramUser: TelegramUser, isParticipant: boolean, tonValue = 0, existingPlayersCount = 0): Player => {
      return {
        id: `temp_${telegramUser.id}_${Date.now()}`, // Временный ID, будет заменен UUID из DB
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

  // Функция для обновления онлайн-статуса
  const updateOnlineStatus = useCallback(async () => {
    if (!user || !defaultRoomId) return

    try {
      const userAvatar = getUserPhotoUrl(user)
      const userDisplayName = getUserDisplayName(user)
      await ensureUserOnline(defaultRoomId, user.id, user.username, userAvatar, userDisplayName)
    } catch (err: any) {
      console.warn("Online status update failed:", err.message)
    }
  }, [user, defaultRoomId, getUserPhotoUrl, getUserDisplayName]) // Теперь не зависит от roomState

  // Отдельный useEffect для интервала обновления онлайн-статуса
  useEffect(() => {
    if (!isReady || !user || !defaultRoomId) return

    console.log("Setting up online status interval.")
    updateOnlineStatus() // Первый вызов при монтировании
    onlineUpdateIntervalRef.current = setInterval(updateOnlineStatus, 1000)

    return () => {
      console.log("Cleaning up online status interval.")
      if (onlineUpdateIntervalRef.current) {
        clearInterval(onlineUpdateIntervalRef.current)
        onlineUpdateIntervalRef.current = null
      }
    }
  }, [isReady, user, defaultRoomId, updateOnlineStatus]) // Зависит только от стабильных значений и useCallback

  // Подписка на Realtime изменения комнаты и игроков (теперь с минимальными зависимостями)
  useEffect(() => {
    if (!isReady || !supabase || !defaultRoomId) return

    console.log("Setting up Supabase Realtime subscriptions...")

    // Подписка на изменения комнаты
    const roomSubscription = supabase
      .channel(`room:${defaultRoomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `id=eq.${defaultRoomId}` },
        (payload) => {
          if (payload.eventType === "UPDATE" || payload.eventType === "INSERT") {
            console.log("Realtime: Room update received:", payload.new)
            setRoomState(payload.new as RoomState)
          }
        },
      )
      .subscribe()

    // Подписка на изменения игроков
    const playerSubscription = supabase
      .channel(`players_in_room:${defaultRoomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `room_id=eq.${defaultRoomId}` },
        async (payload) => {
          console.log("Realtime: Player update received:", payload.eventType, payload.new || payload.old)
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
          } catch (err: any) {
            console.error("Realtime Player Update Error:", err.message)
          }
        },
      )
      .subscribe()

    return () => {
      console.log("Cleaning up Supabase Realtime subscriptions.")
      supabase.removeChannel(roomSubscription)
      supabase.removeChannel(playerSubscription)
    }
  }, [isReady, supabase, defaultRoomId]) // Минимальные зависимости для подписок

  // Calculate participants with percentages using useMemo
  const participantsWithPercentages = useMemo(() => {
    const totalTon = participantsForGame.reduce((sum, p) => sum + p.tonValue, 0)
    return participantsForGame.map((p) => ({
      ...p,
      percentage: totalTon > 0 ? (p.tonValue / totalTon) * 100 : 0,
    }))
  }, [participantsForGame])

  // Логика таймера и анимации колеса
  useEffect(() => {
    // Используем roomStateRef.current для доступа к актуальному roomState
    const currentRoomState = roomStateRef.current
    if (!currentRoomState) return

    console.log(
      "Game logic useEffect triggered. Current roomState:",
      currentRoomState.status,
      "Countdown end:",
      currentRoomState.countdown_end_time,
      "Spin Trigger:",
      spinTrigger,
    )

    // --- Countdown animation logic ---
    if (currentRoomState.status === "countdown") {
      if (!countdownSpinIntervalRef.current) {
        console.log("Starting countdown spin animation.")
        countdownSpinIntervalRef.current = setInterval(() => {
          setRotation((prev) => prev + 2) // Непрерывное вращение
        }, 50)
      }
    } else {
      // If status is not countdown, stop the animation
      if (countdownSpinIntervalRef.current) {
        console.log("Stopping countdown spin animation.")
        clearInterval(countdownSpinIntervalRef.current)
        countdownSpinIntervalRef.current = null
      }
    }

    // --- Timer logic: client-side countdown ---
    if (currentRoomState.status === "countdown" && currentRoomState.countdown_end_time) {
      const endTime = new Date(currentRoomState.countdown_end_time).getTime()

      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current) // Clear existing interval to prevent duplicates

      countdownIntervalRef.current = setInterval(async () => {
        const now = Date.now()
        const remainingSeconds = Math.max(0, Math.floor((endTime - now) / 1000))
        setCountdownSeconds(remainingSeconds)
        console.log("Countdown:", remainingSeconds)

        if (remainingSeconds <= 0) {
          clearInterval(countdownIntervalRef.current!)
          countdownIntervalRef.current = null
          hapticFeedback.impactOccurred("heavy")

          // This is the critical call: trigger winner determination
          console.log("Countdown reached 0, calling determineWinnerAndSpin...")
          await determineWinnerAndSpin(defaultRoomId)
        } else if (remainingSeconds <= 3 && remainingSeconds > 0) {
          hapticFeedback.impactOccurred("heavy")
        }
      }, 1000)
    } else {
      setCountdownSeconds(0) // Reset timer if not in countdown mode
      if (countdownIntervalRef.current) {
        console.log("Clearing countdown timer.")
        clearInterval(countdownIntervalRef.current)
        countdownIntervalRef.current = null
      }
    }

    // --- Handle final wheel spin and winner announcement ---
    if (currentRoomState.status === "spinning" && spinTrigger === 0) {
      console.log("Room status is spinning, initiating client-side spin animation.")
      const randomRotation = 5400 + Math.random() * 1440 // Ensure enough rotations (15 full spins + 0-4 full spins)
      setRotation((prev) => prev + randomRotation)
      setSpinTrigger(1) // Mark that spin has been triggered

      setTimeout(async () => {
        console.log("Spin animation complete, checking winner and resetting room.")
        try {
          // Use participantsWithPercentages for winner lookup
          const winner = participantsWithPercentages.find((p) => p.telegramId === currentRoomState.winner_telegram_id)
          if (winner) {
            setWinnerDetails(winner)
            setShowWinnerModal(true)
            hapticFeedback.notificationOccurred("success")

            setTimeout(async () => {
              setShowWinnerModal(false)
              console.log("Winner modal closed, resetting room...")
              await resetRoom(defaultRoomId)
              setSpinTrigger(0) // Reset spin trigger for next round
              setRotation(0) // Reset rotation for next round
            }, 4000) // Duration for winner modal display
          } else {
            console.log("No winner found or winner_telegram_id is null, resetting room.")
            await resetRoom(defaultRoomId)
            setSpinTrigger(0) // Reset spin trigger
            setRotation(0) // Reset rotation for next round
          }
        } catch (err: any) {
          handleError(err.message, "Spin Completion")
        }
      }, 8000) // This timeout should match the CSS transition duration for the final spin (8 seconds)
    } else if (currentRoomState.status !== "spinning" && spinTrigger !== 0) {
      // If room status changes away from spinning, reset spinTrigger
      console.log("Room status changed from spinning, resetting spinTrigger and rotation.")
      setSpinTrigger(0)
      setRotation(0) // Ensure rotation is reset if game state changes unexpectedly
    }

    // Cleanup function for all intervals managed by this effect
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current)
        countdownIntervalRef.current = null
      }
      if (countdownSpinIntervalRef.current) {
        clearInterval(countdownSpinIntervalRef.current)
        countdownSpinIntervalRef.current = null
      }
    }
  }, [roomState, spinTrigger, defaultRoomId, hapticFeedback, handleError, participantsWithPercentages]) // Removed participantsForGame from dependencies, added participantsWithPercentages

  const handleAddPlayer = useCallback(
    async (isGift = true, tonAmountToAdd?: number) => {
      if (isAddingPlayer) {
        console.log("Add player: Already processing, skipping.")
        return
      }

      try {
        if (!user || !roomState || !supabase) {
          handleError("Отсутствуют необходимые данные", "Add Player")
          return
        }

        // Check if the game is in a state where adding players is not allowed
        if (roomState.status === "spinning" || roomState.status === "finished") {
          showAlert("Игра уже идет или завершена. Дождитесь нового раунда.")
          hapticFeedback.notificationOccurred("error")
          return
        }

        // Check if countdown is active and too close to end
        if (roomState.status === "countdown" && roomState.countdown_end_time) {
          const remaining = Math.max(
            0,
            Math.floor((new Date(roomState.countdown_end_time).getTime() - Date.now()) / 1000),
          )
          if (remaining <= 3) {
            showAlert("Нельзя присоединиться в последние секунды отсчета.")
            hapticFeedback.notificationOccurred("error")
            return
          }
        }

        setIsAddingPlayer(true) // Устанавливаем состояние загрузки
        setError(null)
        hapticFeedback.impactOccurred("medium")

        const tonValueToAdd = isGift ? Math.random() * 20 + 5 : tonAmountToAdd!
        const giftsToAdd = isGift ? 1 : 0

        // --- Оптимистичное обновление UI ---
        // Update roomState optimistically
        setRoomState((prevRoom) => {
          if (!prevRoom) return null
          const newTotalGifts = prevRoom.total_gifts + giftsToAdd
          const newTotalTon = prevRoom.total_ton + tonValueToAdd
          let newStatus = prevRoom.status
          let newCountdownEndTime = prevRoom.countdown_end_time

          // Logic to transition to countdown if enough players
          if ((prevRoom.status === "waiting" || prevRoom.status === "single_player") && playersInRoom.length + 1 >= 2) {
            newStatus = "countdown"
            newCountdownEndTime = new Date(Date.now() + 20 * 1000).toISOString()
          }

          return {
            ...prevRoom,
            total_gifts: newTotalGifts,
            total_ton: newTotalTon,
            status: newStatus,
            countdown_end_time: newCountdownEndTime,
          }
        })

        // Optimistically update participantsForGame
        setParticipantsForGame((prevParticipants) => {
          const existingParticipantIndex = prevParticipants.findIndex((p) => p.telegramId === user.id)
          let updatedParticipants: Player[]

          if (existingParticipantIndex !== -1) {
            // Update existing participant
            updatedParticipants = prevParticipants.map((p, index) =>
              index === existingParticipantIndex
                ? {
                    ...p,
                    gifts: p.gifts + giftsToAdd,
                    tonValue: p.tonValue + tonValueToAdd,
                    isParticipant: true,
                  }
                : p,
            )
          } else {
            // Add new participant
            const newPlayer = createPlayerObject(user, true, tonValueToAdd, prevParticipants.length)
            newPlayer.gifts = giftsToAdd // Set initial gifts
            updatedParticipants = [...prevParticipants, newPlayer]
          }
          return updatedParticipants // No need to recalculate percentages here, useMemo will handle it
        })

        // --- Вызов серверного действия ---
        console.log("Calling addPlayerToRoom with:", user.id)
        const { room, error } = await addPlayerToRoom(roomState.id, {
          ...createPlayerObject(user, true, tonValueToAdd, participantsForGame.length), // Pass data for RPC
          gifts: giftsToAdd, // Pass giftsToAdd
          tonValue: tonValueToAdd, // Pass tonValueToAdd
        })

        if (error) {
          // If server action failed, revert optimistic update
          console.error("Server action failed, reverting optimistic update:", error)
          // A more robust rollback would fetch the actual state from DB,
          // but for now, we can rely on the next Realtime update to correct it.
          // For simplicity, we'll let Realtime handle the eventual consistency.
          handleError(error, "Add Player to Room")
          return
        }
        console.log("addPlayerToRoom RPC returned room:", room)
        // Realtime subscriptions will automatically update UI, confirming optimistic update
      } catch (error: any) {
        handleError(error.message, "Add Player Exception")
      } finally {
        setIsAddingPlayer(false) // Reset loading state
      }
    },
    [
      user,
      roomState,
      supabase,
      isAddingPlayer,
      hapticFeedback,
      showAlert,
      createPlayerObject,
      participantsForGame, // Keep this dependency for optimistic update logic
      playerColors,
      handleError,
      playersInRoom,
      // initialRoomState, // No longer needed for rollback, relying on Realtime
      // initialParticipantsForGame, // No longer needed for rollback, relying on Realtime
    ],
  )

  const getWheelSegments = useCallback(() => {
    // Use participantsWithPercentages here
    const currentParticipants = participantsWithPercentages
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
  }, [participantsWithPercentages]) // Dependency on the memoized value

  const segments = getWheelSegments()
  // Use participantsWithPercentages for rendering the list of participants
  const participantsToRender = participantsWithPercentages

  const tonButtonFontSizeClass = displayedTonAmount >= 10 ? "text-xs" : "text-base"

  const formatGiftsText = useCallback((count: number) => {
    if (count === 0) return "0 подарков"
    if (count === 1) return "1 подарок"
    if (count >= 2 && count <= 4) return `${count} подарка`
    return `${count} подарков`
  }, [])

  // Show loading only during initial Telegram WebApp initialization or if roomState is not loaded
  if (!isReady || !roomState) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-400 mx-auto mb-4"></div>
          <p className="text-gray-400">{!isReady ? "Подключение к Telegram..." : "Загрузка данных комнаты..."}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-black text-white relative overflow-hidden touch-manipulation">
      {/* Error notification */}
      {error && (
        <div className="fixed top-4 left-4 right-4 z-50">
          <Alert className="bg-red-900/90 border-red-700 backdrop-blur-sm">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-white">{error}</AlertDescription>
          </Alert>
        </div>
      )}

      {/* Top UI elements */}
      <div className="absolute top-4 left-4 right-4 z-20 flex justify-between items-center gap-2">
        {/* Player count in room - ONLY ONLINE PLAYERS LIST */}
        <Dialog>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="bg-black/60 hover:bg-black/80 border border-gray-600 backdrop-blur-sm text-white h-10 px-4 py-2 rounded-lg flex items-center justify-center touch-manipulation"
              onClick={() => hapticFeedback.selectionChanged()}
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
                        src={player.avatar || "/placeholder.svg?height=32&width=32"}
                        alt={player.displayName || "Player avatar"}
                        className="w-8 h-8 rounded-full object-cover"
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

        {/* Current user info */}
        {user && (
          <div className="bg-black/60 border border-gray-600 backdrop-blur-sm rounded-lg px-3 py-2 flex items-center gap-2 h-10">
            <img
              src={getUserPhotoUrl(user) || "/placeholder.svg?height=24&width=24"}
              alt={getUserDisplayName(user) || "User avatar"}
              className="w-6 h-6 rounded-full object-cover"
            />
            <span className="text-sm text-white whitespace-nowrap">{getUserDisplayName(user)}</span>
          </div>
        )}
      </div>

      {/* Total pot */}
      <div className="flex items-center justify-center mb-4 pt-16 relative z-10">
        <div className="flex items-center gap-2 text-green-400">
          <div className="w-2 h-2 bg-green-400 rounded-full flex-shrink-0 animate-pulse"></div>
          <span className="text-lg font-medium">Общий банк</span>
        </div>
      </div>

      {/* Gifts and TON counter */}
      <div className="flex justify-center mb-8 relative z-10">
        <div className="border border-gray-600 px-6 py-3 rounded-xl font-medium text-lg bg-black/20 backdrop-blur-sm">
          {formatGiftsText(roomState.total_gifts)} | {(roomState.total_ton ?? 0).toFixed(1)} ТОН
        </div>
      </div>

      {/* Roulette wheel and pointer */}
      <div className="flex justify-center items-center mb-8 relative px-4">
        {/* Pointer */}
        <div className="absolute top-[-15px] left-1/2 -translate-x-1/2 z-30 transform rotate-180">
          <div className="w-0 h-0 border-l-[10px] border-r-[10px] border-b-[15px] border-l-transparent border-r-transparent border-b-green-500 drop-shadow-lg"></div>
        </div>

        {/* Wheel */}
        <div
          className="w-80 h-80 min-w-80 min-h-80 max-w-80 max-h-80 rounded-full relative shadow-2xl shadow-gray-900/50 wheel-container"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: roomState.status === "spinning" ? "transform 8s cubic-bezier(0.25, 0.1, 0.25, 1)" : "none", // 8 seconds spin
          }}
        >
          {roomState.status === "waiting" ? (
            <div className="w-full h-full bg-gray-600 rounded-full relative">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 bg-black rounded-full flex items-center justify-center border-0">
                <span className="text-gray-300 text-sm font-medium">Ожидание игроков</span>
              </div>
            </div>
          ) : participantsToRender.length === 1 && roomState.status === "single_player" ? (
            <div
              className="w-full h-full rounded-full relative"
              style={{ backgroundColor: participantsToRender[0]?.color }}
            >
              <div className="absolute top-16 left-16 w-8 h-8 rounded-full overflow-hidden border-2 border-white">
                <img
                  src={participantsToRender[0]?.avatar || "/placeholder.svg?height=32&width=32"}
                  alt={participantsToRender[0]?.displayName || "Player avatar"}
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
                        href={segment.player.avatar || "/placeholder.svg?height=16&width=16"}
                        clipPath="circle(8px at center)"
                      />
                    </g>
                  )
                })}
              </svg>

              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 bg-black rounded-full flex items-center justify-center border-0">
                {roomState.status === "countdown" ? (
                  <span className="text-green-400 text-lg font-mono font-bold">{countdownSeconds}</span>
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

      {/* Action buttons */}
      <div className="flex gap-3 px-4 mb-6 relative z-10">
        <Button
          className="flex-1 bg-green-500 hover:bg-green-600 text-black font-medium py-3 rounded-xl disabled:bg-gray-600 disabled:text-gray-400 touch-manipulation transition-all duration-200"
          onClick={() => handleAddPlayer(true)}
          disabled={
            isAddingPlayer || // Используем новое состояние
            roomState.status === "spinning" ||
            roomState.status === "finished" ||
            (roomState.status === "countdown" && countdownSeconds <= 3)
          }
        >
          <Plus className="w-5 h-5 mr-2" />
          {isAddingPlayer ? "Добавляем..." : "Добавить гифт"}
        </Button>

        <Button
          className={`flex-1 font-medium py-3 rounded-xl flex items-center justify-center touch-manipulation transition-all duration-200 ${
            isAddingPlayer || (roomState.status === "countdown" && countdownSeconds <= 3) // Используем новое состояние
              ? "bg-gray-600 text-gray-400 cursor-not-allowed"
              : "bg-green-400 hover:bg-green-500 text-black"
          }`}
          onClick={() => {
            handleAddPlayer(false, displayedTonAmount)
            setDisplayedTonAmount(Math.floor(Math.random() * 20 + 5))
          }}
          disabled={
            isAddingPlayer || // Используем новое состояние
            roomState.status === "spinning" ||
            roomState.status === "finished" ||
            (roomState.status === "countdown" && countdownSeconds <= 3)
          }
        >
          <span className="text-2xl mr-2 flex-shrink-0">🎁</span>
          <span className={`whitespace-nowrap ${tonButtonFontSizeClass}`}>
            {isAddingPlayer ? "Добавляем..." : `Добавить ${displayedTonAmount} ТОН`}
          </span>
        </Button>
      </div>

      {/* Navigation icons */}
      <div className="flex justify-center gap-4 mb-6 relative z-10">
        {items.map((item, index) => (
          <Button
            key={index}
            variant="ghost"
            className="flex flex-col items-center gap-1 text-gray-400 hover:text-white py-3 touch-manipulation transition-colors duration-200"
            onClick={() => hapticFeedback.selectionChanged()}
          >
            <span className="text-lg">{item.icon}</span>
            <span className="text-xs">{item.label}</span>
          </Button>
        ))}
      </div>

      {/* List of game participants with their bets */}
      <div className="px-4 mb-6 relative z-10 mobile-safe-area">
        {participantsToRender.length === 0 ? (
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
            {participantsToRender.map((player) => (
              <div key={player.id} className="mb-3">
                <Card className="bg-black/60 border-gray-600 p-4 backdrop-blur-sm transition-all duration-200 hover:bg-black/70">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <img
                        src={player.avatar || "/placeholder.svg?height=40&width=40"}
                        alt={player.displayName || "Player avatar"}
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

      {/* Winner modal */}
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
              src={winnerDetails.avatar || "/placeholder.svg?height=64&width=64"}
              alt={winnerDetails.displayName || "Winner avatar"}
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
