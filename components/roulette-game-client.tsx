"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Plus, X, Eye, Users, AlertCircle, RotateCcw } from "lucide-react"
import { useTelegram } from "../hooks/useTelegram"
import type { TelegramUser } from "../types/telegram"
import { createClientComponentClient } from "@/lib/supabase"
import { getPlayersInRoom, ensureUserOnline, getParticipants } from "@/app/actions"
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
  const [rotation, setRotation] = useState(0) // Оставим для базовой анимации, если захотите
  const [showWinnerModal, setShowWinnerModal] = useState(false)
  const [winnerDetails, setWinnerDetails] = useState<Player | null>(null)
  const [displayedTonAmount, setDisplayedTonAmount] = useState(Math.floor(Math.random() * 20 + 5))
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(initialError)
  const [countdownSeconds, setCountdownSeconds] = useState(0)

  const playerColors = ["#ef4444", "#22c55e", "#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899"]
  const onlineUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Функция для обработки ошибок
  const handleError = useCallback(
    (message: string, context: string) => {
      console.error(`[${context}] Error:`, message)
      setError(message)
      setIsLoading(false)
      hapticFeedback.notificationOccurred("error")
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
    } catch (err: any) {
      console.warn("Online status update failed:", err.message)
    }
  }, [user, roomState, getUserPhotoUrl, getUserDisplayName])

  // Подписка на Realtime изменения комнаты и игроков
  useEffect(() => {
    if (!isReady || !user || !supabase || !roomState) return

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

    // Обновление онлайн-статуса при входе и установка интервала
    updateOnlineStatus()
    onlineUpdateIntervalRef.current = setInterval(updateOnlineStatus, 1000)

    return () => {
      console.log("Cleaning up Supabase Realtime subscriptions.")
      supabase.removeChannel(roomSubscription)
      supabase.removeChannel(playerSubscription)
      if (onlineUpdateIntervalRef.current) {
        clearInterval(onlineUpdateIntervalRef.current)
        onlineUpdateIntervalRef.current = null
      }
    }
  }, [isReady, user, supabase, defaultRoomId, updateOnlineStatus, roomState])

  // --- Упрощенная логика для кнопок и отображения ---
  const handleAddPlayerClick = useCallback(
    (isGift: boolean, tonAmountToAdd?: number) => {
      if (!user) {
        showAlert("Пользователь не определен.")
        return
      }
      hapticFeedback.impactOccurred("medium")
      const amount = isGift ? "гифт" : `${tonAmountToAdd} ТОН`
      showAlert(`Кнопка "Добавить ${amount}" нажата. Логика добавления игрока пока отключена.`)
      console.log(`Attempted to add ${amount} for user:`, user.username || user.id)
    },
    [user, showAlert, hapticFeedback],
  )

  const handleResetGameClick = useCallback(() => {
    hapticFeedback.impactOccurred("light")
    showAlert("Кнопка 'Сбросить игру' нажата. Логика сброса игры пока отключена.")
    console.log("Attempted to reset game.")
  }, [showAlert, hapticFeedback])

  const getWheelSegments = useCallback(() => {
    // В этой упрощенной версии, колесо будет просто отображать участников без сложной логики ставок
    // Если участников нет, можно показать заглушку
    if (participantsForGame.length === 0) {
      return [
        {
          player: {
            color: "#4b5563",
            displayName: "Нет участников",
            avatar: "/placeholder.svg?height=16&width=16",
            percentage: 100,
          } as Player,
          startAngle: 0,
          endAngle: 360,
          angle: 360,
        },
      ]
    }

    let currentAngle = 0
    const segmentSize = 360 / participantsForGame.length // Делим колесо поровну
    return participantsForGame.map((player) => {
      const segment = {
        player,
        startAngle: currentAngle,
        endAngle: currentAngle + segmentSize,
        angle: segmentSize,
      }
      currentAngle += segmentSize
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

      {/* Loading indicator for actions */}
      {isLoading && (
        <div className="fixed top-20 left-4 right-4 z-50">
          <Alert className="bg-blue-900/90 border-blue-700 backdrop-blur-sm">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400"></div>
            <AlertDescription className="text-white ml-2">Обработка запроса...</AlertDescription>
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

      {/* Reset game button */}
      <div className="absolute top-4 right-4 z-20">
        <Button
          variant="ghost"
          size="sm"
          className="bg-black/60 hover:bg-black/80 border border-gray-600 backdrop-blur-sm text-white h-10 px-4 py-2 rounded-lg flex items-center justify-center touch-manipulation"
          onClick={handleResetGameClick}
          disabled={isLoading}
        >
          <RotateCcw className="w-4 h-4 mr-2" />
          <span className="text-sm whitespace-nowrap">Сбросить игру</span>
        </Button>
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
          // В этой версии колесо не будет вращаться по игровой логике
          style={{ transform: `rotate(${rotation}deg)` }}
        >
          {participants.length === 0 ? (
            <div className="w-full h-full bg-gray-600 rounded-full relative">
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
                <span className="text-gray-300 text-sm font-medium">Готов к игре</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 px-4 mb-6 relative z-10">
        <Button
          className="flex-1 bg-green-500 hover:bg-green-600 text-black font-medium py-3 rounded-xl disabled:bg-gray-600 disabled:text-gray-400 touch-manipulation transition-all duration-200"
          onClick={() => handleAddPlayerClick(true)}
          disabled={isLoading}
        >
          <Plus className="w-5 h-5 mr-2" />
          {isLoading ? "Добавляем..." : "Добавить гифт"}
        </Button>

        <Button
          className={`flex-1 font-medium py-3 rounded-xl flex items-center justify-center touch-manipulation transition-all duration-200 ${
            isLoading ? "bg-gray-600 text-gray-400 cursor-not-allowed" : "bg-green-400 hover:bg-green-500 text-black"
          }`}
          onClick={() => {
            handleAddPlayerClick(false, displayedTonAmount)
            setDisplayedTonAmount(Math.floor(Math.random() * 20 + 5))
          }}
          disabled={isLoading}
        >
          <span className="text-2xl mr-2 flex-shrink-0">🎁</span>
          <span className={`whitespace-nowrap ${tonButtonFontSizeClass}`}>
            {isLoading ? "Добавляем..." : `Добавить ${displayedTonAmount} ТОН`}
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
        {participants.length === 0 ? (
          <Card className="bg-black/60 border-gray-600 p-4 backdrop-blur-sm text-center mb-4">
            <p className="text-gray-400">Нет участников в текущей игре</p>
            <p className="text-gray-500 text-sm mt-2">Добавьте ТОН, чтобы начать игру!</p>
          </Card>
        ) : (
          <>
            <div className="text-center mb-4">
              <h3 className="text-lg font-bold text-white">Участники игры</h3>
              <p className="text-sm text-gray-400">Ставки отображаются</p>
            </div>
            {participants.map((player) => (
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

      {/* Winner modal (still present but won't be triggered by game logic) */}
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
