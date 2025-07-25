"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Plus, X, Eye, AlertCircle } from "lucide-react"
import { useTelegram } from "../hooks/useTelegram"
import { createClientComponentClient } from "@/lib/supabase"
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js"
import {
  addPlayerToRoom,
  getPlayersInRoom,
  ensureUserOnline,
  determineWinnerAndSpin,
  resetRoom,
  getParticipants,
} from "@/app/actions"
import { Alert, AlertDescription } from "@/components/ui/alert"
import type { Player, SupabasePlayer } from "@/types/player"
import type { TelegramUser } from "@/types/telegram"

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

// Helper functions for color generation (can be outside the component)
function generateRandomHexColor() {
  const letters = "0123456789ABCDEF"
  let color = "#"
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)]
  }
  return color
}

// Simple check for color similarity (can be improved)
function areColorsSimilar(color1: string, color2: string, threshold = 50) {
  const hexToRgb = (hex: string) => {
    const r = Number.parseInt(hex.substring(1, 3), 16)
    const g = Number.parseInt(hex.substring(3, 5), 16)
    const b = Number.parseInt(hex.substring(5, 7), 16)
    return { r, g, b }
  }

  const rgb1 = hexToRgb(color1)
  const rgb2 = hexToRgb(color2)

  const diffR = Math.abs(rgb1.r - rgb2.r)
  const diffG = Math.abs(rgb1.g - rgb2.g)
  const diffB = Math.abs(rgb1.b - rgb2.b)

  return (diffR + diffG + diffB) / 3 < threshold
}

function generateUniqueRandomColor(existingColors: string[], maxAttempts = 100): string {
  let newColor: string
  let attempts = 0
  do {
    newColor = generateRandomHexColor()
    attempts++
    if (attempts > maxAttempts) {
      console.warn("Max attempts reached for unique color generation. Falling back to a default color.")
      return "#CCCCCC" // A neutral fallback color
    }
  } while (existingColors.some((c) => areColorsSimilar(c, newColor)))

  return newColor
}

export default function RouletteGameClient({
  initialRoomState,
  initialPlayersInRoom,
  initialParticipantsForGame,
  initialError,
  defaultRoomId,
}: RouletteGameClientProps) {
  // Все вызовы хуков должны быть здесь, в начале компонента, безусловно.
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

  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const onlineUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const playersListUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null) // New ref for players list update
  const resetRoomTimeoutRef = useRef<NodeJS.Timeout | null>(null) // New ref for reset room timeout

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
      // isAddingPlayer is now handled in finally block
      hapticFeedback.notificationOccurred("error")
      setTimeout(() => setError(null), 5000)
    },
    [hapticFeedback],
  )

  // Modified createBasePlayerObject to be more generic
  const createBasePlayerObject = useCallback(
    (
      telegramUser: TelegramUser,
    ): Omit<Player, "gifts" | "tonValue" | "color" | "percentage" | "isParticipant" | "id"> => {
      return {
        telegramId: telegramUser.id,
        username: telegramUser.username || null,
        displayName: getUserDisplayName(telegramUser),
        avatar: getUserPhotoUrl(telegramUser) || null,
      }
    },
    [getUserDisplayName, getUserPhotoUrl],
  )

  // Функция для обновления онлайн-статуса текущего пользователя
  const updateOnlineStatus = useCallback(async () => {
    if (!user || !defaultRoomId) return

    try {
      const userAvatar = getUserPhotoUrl(user)
      const userDisplayName = getUserDisplayName(user)
      // ИСПРАВЛЕНО: Передаем пустую строку, если userAvatar равен null
      await ensureUserOnline(defaultRoomId, user.id, user.username, userAvatar || "", userDisplayName)
    } catch (err: any) {
      console.warn("Online status update failed:", err.message)
    }
  }, [user, defaultRoomId, getUserPhotoUrl, getUserDisplayName])

  // Отдельный useEffect для интервала обновления онлайн-статуса текущего пользователя
  useEffect(() => {
    if (!isReady || !user || !defaultRoomId) return

    console.log("Setting up online status interval for current user.")
    updateOnlineStatus() // Первый вызов при монтировании
    onlineUpdateIntervalRef.current = setInterval(updateOnlineStatus, 1000) // Обновляем каждую секунду

    return () => {
      console.log("Cleaning up online status interval for current user.")
      if (onlineUpdateIntervalRef.current) {
        clearInterval(onlineUpdateIntervalRef.current)
        onlineUpdateIntervalRef.current = null
      }
    }
  }, [isReady, user, defaultRoomId, updateOnlineStatus])

  // НОВЫЙ useEffect для периодического получения списка онлайн-игроков
  useEffect(() => {
    if (!isReady || !defaultRoomId) return

    const fetchAndSetPlayers = async () => {
      try {
        const { players, error: fetchError } = await getPlayersInRoom(defaultRoomId)
        if (fetchError) {
          console.error("Failed to fetch online players list:", fetchError)
          // Опционально можно показать тост или сообщение об ошибке
        } else {
          setPlayersInRoom(players)
        }
      } catch (err: any) {
        console.error("Exception fetching online players list:", err.message)
      }
    }

    // Первоначальная загрузка при монтировании компонента
    fetchAndSetPlayers()

    // Устанавливаем интервал для периодического обновления (каждые 5 секунд)
    playersListUpdateIntervalRef.current = setInterval(fetchAndSetPlayers, 5000) // 5 секунд

    return () => {
      if (playersListUpdateIntervalRef.current) {
        clearInterval(playersListUpdateIntervalRef.current)
        playersListUpdateIntervalRef.current = null
      }
    }
  }, [isReady, defaultRoomId]) // Зависимости: isReady и defaultRoomId

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
        // ИСПРАВЛЕНО: Явная типизация payload для комнаты
        (payload: RealtimePostgresChangesPayload<RoomState>) => {
          if (payload.eventType === "UPDATE" || payload.eventType === "INSERT") {
            console.log("Realtime: Room update received:", payload.new) // Added log
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
        // ИСПРАВЛЕНО: Явная типизация payload для игроков
        async (payload: RealtimePostgresChangesPayload<SupabasePlayer>) => {
          console.log("Realtime: Player update received:", payload.eventType, payload.new || payload.old)
          try {
            // Realtime для игроков теперь используется только для обновления участников игры,
            // а полный список онлайн-игроков обновляется отдельным интервалом.
            const { participants, error: participantsError } = await getParticipants(defaultRoomId)
            if (participantsError) {
              console.error("Realtime Player Update Error fetching participants:", participantsError)
            } else {
              setParticipantsForGame(participants)
            }
          } catch (err: any) {
            console.error("Realtime Player Update Exception:", err.message)
          }
        },
      )
      .subscribe()

    return () => {
      console.log("Cleaning up Supabase Realtime subscriptions.")
      supabase.removeChannel(roomSubscription)
      supabase.removeChannel(playerSubscription)
    }
  }, [isReady, supabase, defaultRoomId]) // Зависимости: isReady и defaultRoomId

  // Calculate participants with percentages using useMemo
  const participantsWithPercentages = useMemo(() => {
    const currentParticipants = participantsForGame
    if (currentParticipants.length === 0) return []

    const totalTon = currentParticipants.reduce((sum, p) => sum + p.tonValue, 0)
    return currentParticipants.map((p) => ({
      ...p,
      percentage: totalTon > 0 ? (p.tonValue / totalTon) * 100 : 0,
    }))
  }, [participantsForGame]) // Dependency on the memoized value

  // New useEffect for countdown timer logic
  useEffect(() => {
    const currentRoomState = roomStateRef.current // Access current value via ref

    if (currentRoomState?.status === "countdown" && currentRoomState.countdown_end_time) {
      const endTime = new Date(currentRoomState.countdown_end_time).getTime()
      console.log(`[Countdown Timer] Starting. End time: ${currentRoomState.countdown_end_time}, Parsed: ${endTime}`)

      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current) // Clear existing interval

      countdownIntervalRef.current = setInterval(async () => {
        const now = Date.now()
        const remainingSeconds = Math.max(0, Math.floor((endTime - now) / 1000))
        setCountdownSeconds(remainingSeconds)
        console.log(`[Countdown Timer] Now: ${now}, EndTime: ${endTime}, Remaining: ${remainingSeconds}`)

        if (remainingSeconds <= 0) {
          clearInterval(countdownIntervalRef.current!)
          countdownIntervalRef.current = null
          hapticFeedback.impactOccurred("heavy")
          console.log("[Countdown Timer] Reached 0, calling determineWinnerAndSpin...")
          await determineWinnerAndSpin(defaultRoomId)
        } else if (remainingSeconds <= 3 && remainingSeconds > 0) {
          hapticFeedback.impactOccurred("heavy")
        }
      }, 1000)
    } else {
      setCountdownSeconds(0) // Reset timer if not in countdown mode
      if (countdownIntervalRef.current) {
        console.log("[Countdown Timer] Clearing interval due to status change or no end time.")
        clearInterval(countdownIntervalRef.current)
        countdownIntervalRef.current = null
      }
    }

    // Cleanup function for this specific useEffect
    return () => {
      if (countdownIntervalRef.current) {
        console.log("[Countdown Timer] Cleanup on unmount/dependency change.")
        clearInterval(countdownIntervalRef.current)
        countdownIntervalRef.current = null
      }
    }
  }, [roomState?.status, roomState?.countdown_end_time, defaultRoomId, hapticFeedback]) // Dependencies for this specific timer

  // NEW useEffect to automatically reset room if it's in 'finished' state
  useEffect(() => {
    if (roomState?.status === "finished") {
      console.log("[Auto-Reset] Room is in 'finished' state. Scheduling reset...")
      if (resetRoomTimeoutRef.current) {
        clearTimeout(resetRoomTimeoutRef.current)
      }
      resetRoomTimeoutRef.current = setTimeout(async () => {
        console.log("[Auto-Reset] Executing resetRoom after 'finished' state detected.")
        await resetRoom(defaultRoomId)
        setSpinTrigger(0) // Ensure spin trigger is reset
        setRotation(0) // Ensure rotation is reset
      }, 5000) // Reset after 5 seconds
    } else {
      if (resetRoomTimeoutRef.current) {
        console.log("[Auto-Reset] Clearing reset timeout as room status is no longer 'finished'.")
        clearTimeout(resetRoomTimeoutRef.current)
        resetRoomTimeoutRef.current = null
      }
    }
    return () => {
      if (resetRoomTimeoutRef.current) {
        console.log("[Auto-Reset] Cleanup on unmount/dependency change for reset timeout.")
        clearTimeout(resetRoomTimeoutRef.current)
        resetRoomTimeoutRef.current = null
      }
    }
  }, [roomState?.status, defaultRoomId])

  // Main game logic useEffect (now only for spinning and winner announcement)
  useEffect(() => {
    const currentRoomState = roomStateRef.current
    if (!currentRoomState) return

    console.log(
      "Main Game Logic useEffect triggered. Current roomState:",
      currentRoomState.status,
      "Spin Trigger:",
      spinTrigger,
    )
    // --- Handle final wheel spin and winner announcement ---
    if (currentRoomState.status === "spinning" && spinTrigger === 0) {
      console.log("Room status is spinning, initiating client-side spin animation.")
      const randomRotation = 5400 + Math.random() * 1440 // Ensure enough rotations (15 full spins + 0-4 full spins)
      setRotation((prev) => prev + randomRotation)
      setSpinTrigger(1) // Mark that spin has been triggered

      setTimeout(async () => {
        console.log("Spin animation complete, checking winner and showing modal.")
        const winner = participantsWithPercentages.find((p) => p.telegramId === currentRoomState.winner_telegram_id)
        if (winner) {
          setWinnerDetails(winner)
          setShowWinnerModal(true)
          hapticFeedback.notificationOccurred("success")

          // The actual room reset will now be handled by the new useEffect for 'finished' status
          // This timeout is only for closing the winner modal
          setTimeout(() => {
            setShowWinnerModal(false)
            console.log("Winner modal closed.")
            // No need to call resetRoom here, the new useEffect will handle it
          }, 4000) // Duration for winner modal display
        } else {
          console.log("No winner found or winner_telegram_id is null. Room will be reset by auto-reset useEffect.")
          // No need to call resetRoom here, the new useEffect will handle it
        }
      }, 8000) // This timeout should match the CSS transition duration for the final spin (8 seconds)
    } else if (currentRoomState.status !== "spinning" && spinTrigger !== 0) {
      // If room status changes away from spinning, reset spinTrigger
      console.log("Room status changed from spinning, resetting spinTrigger and rotation.")
      setSpinTrigger(0)
      setRotation(0) // Ensure rotation is reset if game state changes unexpectedly
    }

    return () => {
      // Any other cleanup for this specific effect can go here.
    }
  }, [roomState?.status, spinTrigger, defaultRoomId, hapticFeedback, handleError, participantsWithPercentages]) // Dependencies for main game logic

  const handleAddPlayer = useCallback(
    async (isGift = true, tonAmountToAdd?: number) => {
      if (isAddingPlayer) {
        console.log("Add player: Already processing, skipping.")
        return
      }

      setIsAddingPlayer(true) // Set to true immediately when function starts

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

        setError(null)
        hapticFeedback.impactOccurred("medium")

        const tonValueToAdd = isGift ? Math.random() * 20 + 5 : tonAmountToAdd!
        const giftsToAdd = isGift ? 1 : 0

        let playerColor: string
        let playerToUpdate: Player
        let newPlayerId: string

        // Find if the current user is already a participant
        const existingParticipant = participantsForGame.find((p) => p.telegramId === user.id)

        if (existingParticipant) {
          // User is already a participant, update their existing color and values
          playerColor = existingParticipant.color
          playerToUpdate = {
            ...existingParticipant,
            gifts: existingParticipant.gifts + giftsToAdd,
            tonValue: existingParticipant.tonValue + tonValueToAdd,
            isParticipant: true, // Ensure it's true
          }
          newPlayerId = existingParticipant.id // Use existing ID
        } else {
          // New participant, generate a unique color
          const usedColors = participantsForGame.map((p) => p.color)
          playerColor = generateUniqueRandomColor(usedColors)
          newPlayerId = `temp_${user.id}_${Date.now()}` // Temporary ID for optimistic update

          playerToUpdate = {
            ...createBasePlayerObject(user), // Get base info
            id: newPlayerId, // Assign temporary ID
            gifts: giftsToAdd,
            tonValue: tonValueToAdd,
            color: playerColor,
            percentage: 0, // Will be calculated by RPC
            isParticipant: true,
          }
        }

        // --- Optimistic UI Update ---
        setRoomState((prevRoom) => {
          if (!prevRoom) return null
          const newTotalGifts = prevRoom.total_gifts + giftsToAdd
          const newTotalTon = prevRoom.total_ton + tonValueToAdd
          let newStatus = prevRoom.status
          let newCountdownEndTime = prevRoom.countdown_end_time

          const currentParticipantCount = participantsForGame.length
          const willBeNewParticipant = !existingParticipant
          const projectedParticipantCount = currentParticipantCount + (willBeNewParticipant ? 1 : 0)

          if (
            (prevRoom.status === "waiting" || prevRoom.status === "single_player") &&
            projectedParticipantCount >= 2
          ) {
            newStatus = "countdown"
            newCountdownEndTime = new Date(Date.now() + 15 * 1000).toISOString()
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
          const existingIndex = prevParticipants.findIndex((p) => p.telegramId === playerToUpdate.telegramId)
          if (existingIndex !== -1) {
            return prevParticipants.map((p, idx) => (idx === existingIndex ? playerToUpdate : p))
          } else {
            return [...prevParticipants, playerToUpdate]
          }
        })

        // --- Вызов серверного действия ---
        console.log("Calling addPlayerToRoom with:", user.id, "and color:", playerToUpdate.color)
        const { room, error } = await addPlayerToRoom(roomState.id, playerToUpdate) // Pass the full playerToUpdate object

        if (error) {
          console.error("Server action failed, relying on Realtime for correction:", error)
          handleError(error, "Add Player to Room")
          // No return here, let finally handle the state reset
        }
        console.log("addPlayerToRoom RPC returned room:", room)
        // Realtime subscriptions will automatically update UI, confirming optimistic update
      } catch (error: any) {
        handleError(error.message, "Add Player Exception")
      } finally {
        setIsAddingPlayer(false) // Always reset loading state
      }
    },
    [
      user,
      roomState,
      supabase,
      hapticFeedback,
      showAlert,
      createBasePlayerObject,
      participantsForGame,
      playersInRoom,
      handleError,
      getUserDisplayName,
      getUserPhotoUrl,
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

  // Добавьте этот useEffect где-нибудь после других useEffect'ов
  useEffect(() => {
    if (roomState?.status === "waiting" || roomState?.status === "single_player") {
      if (isAddingPlayer) {
        console.log("Room status is waiting/single_player, resetting isAddingPlayer to false as a failsafe.")
        setIsAddingPlayer(false)
      }
    }
  }, [roomState?.status, isAddingPlayer]) // Зависим от isAddingPlayer, чтобы сработать, если он true

  // Show loading only during initial Telegram WebApp initialization or if roomState is not loaded
  // ЭТОТ БЛОК ПЕРЕМЕЩЕН ВНИЗ, ПОСЛЕ ВСЕХ ВЫЗОВОВ ХУКОВ
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
        <Button
          variant="ghost"
          size="sm"
          className="bg-black/60 hover:bg-black/80 border border-gray-600 backdrop-blur-sm text-white h-10 px-4 py-2 rounded-lg flex items-center justify-center touch-manipulation"
          onClick={() => hapticFeedback.selectionChanged()}
        >
          <Eye className="w-4 h-4 mr-2" />
          <span className="text-sm whitespace-nowrap">Онлайн: {playersInRoom.length}</span>
        </Button>

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
            <div className="w-full h-full bg-gray-700 border border-gray-500 rounded-full relative">
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
                <span className="text-gray-300 text-sm font-medium">Ожидание игроков</span>
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
                ) : roomState.status === "spinning" ? (
                  <span className="text-gray-300 text-sm font-medium">Крутим!</span>
                ) : (
                  <span className="text-gray-300 text-sm font-medium">Ожидание игроков</span>
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
          disabled={(() => {
            const isDisabled =
              isAddingPlayer ||
              roomState.status === "spinning" ||
              roomState.status === "finished" ||
              (roomState.status === "countdown" && countdownSeconds <= 3)
            console.log(
              `DEBUG: 'Добавить гифт' button disabled state: ${isDisabled}, isAddingPlayer: ${isAddingPlayer}, roomStatus: ${roomState.status}, countdown: ${countdownSeconds}`,
            )
            return isDisabled
          })()}
        >
          <Plus className="w-5 h-5 mr-2" />
          {isAddingPlayer ? "Добавляем..." : "Добавить гифт"}
        </Button>

        <Button
          className={`flex-1 font-medium py-3 rounded-xl flex items-center justify-center touch-manipulation transition-all duration-200 ${
            isAddingPlayer || (roomState.status === "countdown" && countdownSeconds <= 3)
              ? "bg-gray-600 text-gray-400 cursor-not-allowed"
              : "bg-green-400 hover:bg-green-500 text-black"
          }`}
          onClick={() => {
            handleAddPlayer(false, displayedTonAmount)
            setDisplayedTonAmount(Math.floor(Math.random() * 20 + 5))
          }}
          disabled={(() => {
            const isDisabled =
              isAddingPlayer ||
              roomState.status === "spinning" ||
              roomState.status === "finished" ||
              (roomState.status === "countdown" && countdownSeconds <= 3)
            console.log(
              `DEBUG: 'Добавить ТОН' button disabled state: ${isDisabled}, isAddingPlayer: ${isAddingPlayer}, roomStatus: ${roomState.status}, countdown: ${countdownSeconds}`,
            )
            return isDisabled
          })()}
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
