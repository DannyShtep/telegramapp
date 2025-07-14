"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Plus, X, Eye, Users, Sparkles, Coins, Trophy } from "lucide-react" // Добавил Trophy
import { useTelegram } from "../hooks/useTelegram"
import type { TelegramUser } from "../types/telegram"
import { createClientComponentClient } from "@/lib/supabase"
import {
  getOrCreateRoom,
  addPlayerToRoom,
  updateRoomState,
  getPlayersInRoom,
  ensureUserOnline,
  resetRoom,
} from "@/app/actions" // Добавил resetRoom
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
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
  const [rotation, setRotation] = useState(0)
  const [showWinnerModal, setShowWinnerModal] = useState(false)
  const [displayedTonAmount, setDisplayedTonAmount] = useState(Math.floor(Math.random() * 20 + 5))

  // Новая палитра цветов для игроков в luxury стиле
  const playerColors = ["#FFD700", "#00C853", "#2196F3", "#D32F2F", "#6A1B9A", "#D84315"] // Gold, Emerald, Sapphire, Ruby, Amethyst, Burnt Orange

  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const spinTimeoutRef = useRef<NodeJS.Timeout | null>(null) // Для отслеживания завершения вращения

  const createPlayerObject = (
    telegramUser: TelegramUser,
    isParticipant: boolean,
    tonValue = 0,
    existingPlayersCount = 0,
  ): Player => {
    return {
      id: `temp_${telegramUser.id}_${Date.now()}`,
      telegramId: telegramUser.id,
      username: telegramUser.username || null,
      displayName: getUserDisplayName(telegramUser),
      avatar: getUserPhotoUrl(telegramUser) || null,
      gifts: isParticipant ? 1 : 0,
      tonValue: tonValue,
      color: isParticipant ? playerColors[existingPlayersCount % playerColors.length] : "#444444", // Темный цвет для наблюдателей
      percentage: 0,
      isParticipant: isParticipant,
    }
  }

  useEffect(() => {
    if (!isReady || !user || !supabase) return

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
            setPlayersInRoom(players)
          } else if (error) {
            console.error("Error fetching players:", error)
          }
        }
      } catch (error: any) {
        console.error("Exception in initializeRoom:", error)
      }
    }

    initializeRoom()

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
        async (payload) => {
          const { players, error } = await getPlayersInRoom(defaultRoomId)
          if (error) {
            console.error("Error fetching players after realtime update:", error)
            return
          }
          setPlayersInRoom(players)
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(roomSubscription)
      supabase.removeChannel(playerSubscription)
    }
  }, [isReady, user, supabase, getUserPhotoUrl, getUserDisplayName])

  // Логика вращения и определения победителя
  useEffect(() => {
    if (!roomState) return

    const participants = playersInRoom.filter((p) => p.isParticipant)
    const totalTon = participants.reduce((sum, p) => sum + p.tonValue, 0)

    const playersNext = playersInRoom.map((p) => {
      const newPerc = p.isParticipant && totalTon > 0 ? (p.tonValue / totalTon) * 100 : 0
      return newPerc !== p.percentage ? { ...p, percentage: newPerc } : p
    })

    const hasPlayersChanged = playersNext.some((p, i) => p !== playersInRoom[i])
    if (hasPlayersChanged) {
      setPlayersInRoom(playersNext)
    }

    // Логика таймера обратного отсчета
    if (roomState.status === "countdown" && roomState.countdown > 0) {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)

      countdownIntervalRef.current = setInterval(async () => {
        if (!roomState || roomState.countdown <= 0) return // Добавлена проверка roomState

        const newCountdown = roomState.countdown - 1

        if (newCountdown <= 3 && newCountdown > 0) hapticFeedback.impact("heavy")

        if (newCountdown === 0) {
          // Определяем победителя
          const winner = selectWinner(participants)
          const winnerTelegramId = winner ? winner.telegramId : null

          // Запускаем вращение
          const randomRotation = 5400 + Math.random() * 1440 // 15 полных оборотов + 4 полных оборота
          setRotation((prev) => prev + randomRotation)
          hapticFeedback.impact("heavy")

          await updateRoomState(defaultRoomId, {
            status: "spinning",
            countdown: 0,
            winner_telegram_id: winnerTelegramId,
          })

          // Устанавливаем таймаут для показа модального окна победителя после завершения вращения
          if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current)
          spinTimeoutRef.current = setTimeout(async () => {
            if (winnerTelegramId) {
              setShowWinnerModal(true)
              hapticFeedback.notification("success")
            }
            await updateRoomState(defaultRoomId, { status: "finished" }) // Обновляем статус на "finished"
          }, 15000) // Длительность анимации вращения
        } else {
          await updateRoomState(defaultRoomId, { countdown: newCountdown })
        }
      }, 1000)
    } else if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = null
    }

    // Очистка таймаутов при размонтировании или изменении статуса
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current)
        countdownIntervalRef.current = null
      }
      if (spinTimeoutRef.current) {
        clearTimeout(spinTimeoutRef.current)
        spinTimeoutRef.current = null
      }
    }
  }, [roomState, playersInRoom, hapticFeedback])

  // Логика выбора победителя
  const selectWinner = (participants: Player[]): Player | null => {
    if (participants.length === 0) return null

    const totalTon = participants.reduce((sum, p) => sum + p.tonValue, 0)
    if (totalTon === 0) return participants[Math.floor(Math.random() * participants.length)] // Если ТОН 0, выбираем случайно

    const randomValue = Math.random() * totalTon
    let cumulativeTon = 0

    for (const player of participants) {
      cumulativeTon += player.tonValue
      if (randomValue <= cumulativeTon) {
        return player
      }
    }
    return participants[participants.length - 1] // Fallback, если что-то пошло не так
  }

  const handleAddPlayer = useCallback(
    async (isGift = true, tonAmountToAdd?: number) => {
      try {
        if (!user || !roomState || !supabase) {
          console.error("handleAddPlayer: User, roomState or Supabase client is null", { user, roomState, supabase })
          return
        }

        if (roomState.status === "countdown" && roomState.countdown <= 3) {
          showAlert("Нельзя добавить гифт во время последних секунд отсчета!")
          hapticFeedback.notification("error")
          return
        }
        if (roomState.status === "spinning" || roomState.status === "finished") {
          showAlert("Нельзя добавить гифт во время вращения или после завершения игры!")
          hapticFeedback.notification("error")
          return
        }

        const existingParticipant = playersInRoom.find((p) => p.telegramId === user.id && p.isParticipant)
        if (existingParticipant) {
          showAlert("Вы уже участвуете в игре!")
          hapticFeedback.notification("error")
          return
        }

        const tonValue = isGift ? Math.floor(Math.random() * 20 + 5) : tonAmountToAdd! // Целые числа для ТОН
        const newPlayer = createPlayerObject(user, true, tonValue, playersInRoom.filter((p) => p.isParticipant).length)

        hapticFeedback.impact("medium")

        const { player, error } = await addPlayerToRoom(roomState.id, newPlayer)

        if (error) {
          console.error("handleAddPlayer: Error adding player via Server Action:", error)
          showAlert(`Ошибка: ${error}`)
          return
        }
        if (!player) {
          console.error("handleAddPlayer: Server Action returned null player.")
          showAlert("Не удалось добавить игрока.")
          return
        }

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
        showAlert(`Произошла ошибка: ${error.message}`)
      }
    },
    [user, roomState, playersInRoom, hapticFeedback, supabase, showAlert],
  )

  const handleResetRoom = useCallback(async () => {
    hapticFeedback.impact("heavy")
    const confirmed = await showAlert(
      "Вы уверены, что хотите сбросить комнату? Все игроки будут удалены, и игра начнется заново.",
    )
    if (confirmed) {
      const { success, error } = await resetRoom(defaultRoomId)
      if (error) {
        console.error("Error resetting room:", error)
        showAlert(`Ошибка сброса комнаты: ${error}`)
      } else if (success) {
        showAlert("Комната успешно сброшена!")
        setShowWinnerModal(false) // Скрываем модал победителя при сбросе
        setRotation(0) // Сбрасываем вращение колеса
      }
    }
  }, [hapticFeedback, showAlert])

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

  if (!supabase) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-darkblue-dark via-charcoal-dark to-darkblue-light text-white">
        <div className="text-center p-8 bg-charcoal/50 backdrop-blur-lg rounded-2xl border border-charcoal-light/20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gold-dark mx-auto mb-4"></div>
          <p className="text-gray-400">Supabase не настроен. Добавьте переменные окружения или разверните на Vercel.</p>
        </div>
      </div>
    )
  }

  if (!isReady || !roomState) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-darkblue-dark via-charcoal-dark to-darkblue-light text-white flex items-center justify-center">
        <div className="text-center">
          <div className="relative">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-gold-dark/30 border-t-gold-dark mx-auto mb-6"></div>
            <div className="absolute inset-0 animate-pulse-subtle rounded-full h-16 w-16 border-4 border-gold-dark/20 mx-auto"></div>
          </div>
          <p className="text-gray-400 text-lg font-medium">Подключение к Telegram и загрузка комнаты...</p>
          <div className="flex justify-center mt-4 space-x-1">
            <div className="w-2 h-2 bg-gold-dark rounded-full animate-pulse-subtle"></div>
            <div
              className="w-2 h-2 bg-gold-dark rounded-full animate-pulse-subtle"
              style={{ animationDelay: "0.1s" }}
            ></div>
            <div
              className="w-2 h-2 bg-gold-dark rounded-full animate-pulse-subtle"
              style={{ animationDelay: "0.2s" }}
            ></div>
          </div>
        </div>
      </div>
    )
  }

  const currentWinner = roomState.winner_telegram_id
    ? playersInRoom.find((p) => p.telegramId === roomState.winner_telegram_id)
    : null

  return (
    <div className="min-h-screen bg-gradient-to-br from-darkblue-dark via-charcoal-dark to-darkblue-light text-white relative overflow-hidden">
      {/* Animated background particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(30)].map((_, i) => (
          <div
            key={i}
            className="absolute w-0.5 h-0.5 bg-white/10 rounded-full animate-pulse-subtle"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 5}s`,
              animationDuration: `${3 + Math.random() * 5}s`,
            }}
          />
        ))}
      </div>

      {/* Верхние элементы UI */}
      <div className="absolute top-4 left-4 right-4 z-20 flex justify-between items-center gap-2">
        {/* Счетчик игроков в комнате */}
        <Dialog>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="bg-charcoal/50 hover:bg-charcoal/70 border border-charcoal-light/20 backdrop-blur-lg text-white h-12 px-6 py-2 rounded-2xl flex items-center justify-center transition-all duration-300 hover:scale-[1.02] shadow-lg hover:shadow-xl"
              onClick={() => hapticFeedback.selection()}
            >
              <Eye className="w-4 h-4 mr-2 text-sapphire" />
              <span className="text-sm font-medium whitespace-nowrap">Онлайн: {playersInRoom.length}</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-charcoal-dark/90 backdrop-blur-xl border-charcoal-light/20 rounded-3xl max-w-sm w-full max-h-[60vh] flex flex-col shadow-2xl modal-enter">
            <DialogHeader className="flex items-center justify-between p-6 border-b border-charcoal-light/10 flex-shrink-0 flex-row">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-sapphire to-darkblue-light rounded-xl">
                  <Users className="w-5 h-5 text-white" />
                </div>
                <DialogTitle className="text-xl font-bold text-white">Онлайн игроки</DialogTitle>
              </div>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto p-6">
              {playersInRoom.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-gradient-to-r from-charcoal to-charcoal-light rounded-full mx-auto mb-4 flex items-center justify-center">
                    <Users className="w-8 h-8 text-gray-600" />
                  </div>
                  <p className="text-gray-500">В комнате пока нет игроков</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {playersInRoom.map((player) => (
                    <div
                      key={player.id}
                      className={`flex items-center gap-4 p-4 rounded-2xl transition-all duration-300 hover:scale-[1.02] ${
                        player.isParticipant
                          ? "bg-charcoal/30 border border-charcoal-light/20"
                          : "bg-charcoal/10 border border-charcoal-light/10"
                      }`}
                    >
                      <div className="relative">
                        <div className="w-3 h-3 bg-emerald rounded-full animate-pulse-subtle"></div>
                        <div className="absolute inset-0 w-3 h-3 bg-emerald rounded-full animate-pulse-subtle opacity-30"></div>
                      </div>
                      <div className="relative">
                        <img
                          src={player.avatar || "/placeholder.svg"}
                          alt="Player"
                          className="w-10 h-10 rounded-full object-cover shadow-lg"
                          style={{
                            border: player.isParticipant ? `3px solid ${player.color}` : "3px solid #6b7280",
                            boxShadow: player.isParticipant
                              ? `0 0 15px ${player.color}40`
                              : "0 0 8px rgba(107, 114, 128, 0.3)",
                          }}
                        />
                        {player.isParticipant && (
                          <div className="absolute -top-1 -right-1 w-4 h-4 bg-gradient-to-r from-gold to-gold-dark rounded-full flex items-center justify-center">
                            <Sparkles className="w-2 h-2 text-white" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1">
                        <span className="text-white font-semibold text-base">{player.displayName}</span>
                        {player.isParticipant && (
                          <div className="text-xs text-gray-400 mt-1 flex items-center gap-2">
                            <span className="px-2 py-1 bg-sapphire/20 rounded-full text-sapphire-light">Участник</span>
                          </div>
                        )}
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
          <div className="bg-charcoal/50 border border-charcoal-light/20 backdrop-blur-lg rounded-2xl px-4 py-2 flex items-center gap-3 h-12 shadow-lg">
            <div className="relative">
              <img
                src={getUserPhotoUrl(user) || "/placeholder.svg"}
                alt="Avatar"
                className="w-8 h-8 rounded-full border-2 border-gold/30 shadow-lg"
              />
              <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-emerald rounded-full border-2 border-charcoal-dark"></div>
            </div>
            <span className="text-sm text-white font-medium whitespace-nowrap">{getUserDisplayName(user)}</span>
          </div>
        )}
      </div>

      {/* Общий банк */}
      <div className="flex items-center justify-center mb-6 pt-20 relative z-10">
        <div className="bg-gradient-to-r from-emerald/20 to-sapphire/20 backdrop-blur-lg border border-emerald/20 rounded-2xl px-6 py-3 shadow-xl">
          <div className="flex items-center gap-3 text-emerald-light">
            <div className="relative">
              <div className="w-3 h-3 bg-emerald rounded-full animate-pulse-subtle"></div>
              <div className="absolute inset-0 w-3 h-3 bg-emerald rounded-full animate-pulse-subtle opacity-50"></div>
            </div>
            <span className="text-lg font-bold">Общий банк</span>
            <Coins className="w-5 h-5 text-gold" />
          </div>
        </div>
      </div>

      {/* Счетчик подарков и ТОН */}
      <div className="flex justify-center mb-8 relative z-10">
        <div className="bg-charcoal/30 backdrop-blur-lg border border-charcoal-light/20 px-8 py-4 rounded-3xl font-bold text-xl shadow-2xl">
          <div className="flex items-center gap-4">
            <span className="text-white">{formatGiftsText(roomState.total_gifts)}</span>
            <div className="w-px h-6 bg-charcoal-light/30"></div>
            <div className="flex items-center gap-2">
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-gold to-gold-dark">
                {(roomState.total_ton ?? 0).toFixed(1)} ТОН
              </span>
              <div className="w-6 h-6 bg-gradient-to-r from-gold to-gold-dark rounded-full flex items-center justify-center">
                <span className="text-charcoal-dark text-xs font-bold">₮</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Колесо рулетки и указатель */}
      <div className="flex justify-center items-center mb-8 relative px-4">
        {/* Указатель */}
        <div className="absolute top-[-20px] left-1/2 -translate-x-1/2 z-30 transform rotate-180">
          <div className="relative">
            <div className="w-0 h-0 border-l-[15px] border-r-[15px] border-b-[25px] border-l-transparent border-r-transparent border-b-gold drop-shadow-lg"></div>
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[12px] border-r-[12px] border-b-[20px] border-l-transparent border-r-transparent border-b-white/80"></div>
          </div>
        </div>

        {/* Внешнее кольцо колеса */}
        <div className="absolute w-96 h-96 rounded-full bg-gradient-to-r from-sapphire/30 to-darkblue-light/30 animate-spin-elegant"></div>

        {/* Колесо */}
        <div
          className="w-80 h-80 min-w-80 min-h-80 max-w-80 max-h-80 rounded-full relative shadow-2xl"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: roomState.status === "spinning" ? "transform 15s cubic-bezier(0.25, 0.1, 0.25, 1)" : "none",
            boxShadow: "0 0 60px rgba(33, 150, 243, 0.5), 0 0 100px rgba(106, 27, 154, 0.3)", // Sapphire and Amethyst glow
          }}
        >
          {roomState.status === "waiting" ? (
            <div className="w-full h-full bg-gradient-to-br from-charcoal-dark to-black rounded-full relative border-4 border-charcoal-light/20">
              <div className="absolute inset-4 bg-gradient-to-br from-black to-charcoal-dark rounded-full"></div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-28 h-28 bg-gradient-to-br from-charcoal-dark to-black rounded-full flex items-center justify-center border-4 border-charcoal-light/10 shadow-inner">
                <div className="text-center">
                  <div className="w-8 h-8 bg-gradient-to-r from-gray-700 to-gray-800 rounded-full mx-auto mb-2 animate-pulse-subtle"></div>
                  <span className="text-gray-500 text-sm font-medium">Ожидание</span>
                </div>
              </div>
            </div>
          ) : participants.length === 1 && roomState.status === "single_player" ? (
            <div
              className="w-full h-full rounded-full relative border-4 border-charcoal-light/30"
              style={{
                background: `linear-gradient(135deg, ${participants[0]?.color}80, ${participants[0]?.color}40)`,
                boxShadow: `0 0 40px ${participants[0]?.color}60`,
              }}
            >
              <div
                className="absolute inset-4 rounded-full"
                style={{ backgroundColor: `${participants[0]?.color}20` }}
              ></div>
              <div className="absolute top-16 left-16 w-12 h-12 rounded-full overflow-hidden border-4 border-white shadow-lg">
                <img
                  src={participants[0]?.avatar || "/placeholder.svg"}
                  alt="Player"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-28 h-28 bg-gradient-to-br from-charcoal-dark to-black rounded-full flex items-center justify-center border-4 border-charcoal-light/20 shadow-inner">
                <div className="text-center">
                  <div className="w-8 h-8 bg-gradient-to-r from-emerald to-sapphire rounded-full mx-auto mb-2 animate-pulse-subtle"></div>
                  <span className="text-gray-400 text-sm font-medium">Ожидание</span>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="absolute inset-0 rounded-full border-4 border-charcoal-light/30 shadow-inner"></div>
              <svg className="w-full h-full" viewBox="0 0 200 200">
                <defs>
                  {segments.map((segment, index) => (
                    <linearGradient
                      key={`gradient-${index}`}
                      id={`gradient-${index}`}
                      x1="0%"
                      y1="0%"
                      x2="100%"
                      y2="100%"
                    >
                      <stop offset="0%" stopColor={segment.player.color} />
                      <stop offset="100%" stopColor={`${segment.player.color}80`} />
                    </linearGradient>
                  ))}
                </defs>
                {segments.map((segment, index) => {
                  const startAngleRad = (segment.startAngle * Math.PI) / 180
                  const endAngleRad = (segment.endAngle * Math.PI) / 180
                  const largeArcFlag = segment.angle > 180 ? 1 : 0

                  const x1 = 100 + 95 * Math.cos(startAngleRad)
                  const y1 = 100 + 95 * Math.sin(startAngleRad)
                  const x2 = 100 + 95 * Math.cos(endAngleRad)
                  const y2 = 100 + 95 * Math.sin(endAngleRad)

                  const pathData = [`M 100 100`, `L ${x1} ${y1}`, `A 95 95 0 ${largeArcFlag} 1 ${x2} ${y2}`, "Z"].join(
                    " ",
                  )

                  const midAngle = (segment.startAngle + segment.endAngle) / 2
                  const midAngleRad = (midAngle * Math.PI) / 180
                  const avatarX = 100 + 65 * Math.cos(midAngleRad)
                  const avatarY = 100 + 65 * Math.sin(midAngleRad)

                  return (
                    <g key={index}>
                      <path
                        d={pathData}
                        fill={`url(#gradient-${index})`}
                        stroke="rgba(255,255,255,0.1)" // Более тонкая граница
                        strokeWidth="0.5"
                      />
                      <circle
                        cx={avatarX}
                        cy={avatarY}
                        r="12"
                        fill="white"
                        stroke={segment.player.color}
                        strokeWidth="2" // Чуть тоньше граница аватара
                        filter="drop-shadow(0 2px 4px rgba(0,0,0,0.4))" // Менее выраженная тень
                      />
                      <image
                        x={avatarX - 12}
                        y={avatarY - 12}
                        width="24"
                        height="24"
                        href={segment.player.avatar || "/placeholder.svg"}
                        clipPath="circle(12px at center)"
                      />
                    </g>
                  )
                })}
              </svg>

              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-28 h-28 bg-gradient-to-br from-charcoal-dark to-black rounded-full flex items-center justify-center border-4 border-charcoal-light/20 shadow-2xl">
                {roomState.status === "countdown" ? (
                  <div className="text-center">
                    <div className="text-2xl font-mono font-bold text-transparent bg-clip-text bg-gradient-to-r from-ruby to-ruby-dark mb-1">
                      {String(Math.floor(roomState.countdown / 60)).padStart(2, "0")}:
                      {String(roomState.countdown % 60).padStart(2, "0")}
                    </div>
                    <div className="w-16 h-1 bg-gradient-to-r from-ruby to-ruby-dark rounded-full animate-pulse-subtle"></div>
                  </div>
                ) : (
                  <div className="text-center">
                    <div className="w-8 h-8 bg-gradient-to-r from-emerald to-sapphire rounded-full mx-auto mb-2 animate-spin"></div>
                    <span className="text-gray-400 text-sm font-medium">
                      {roomState.status === "spinning" ? "Крутим!" : "Ожидание"}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Кнопки действий */}
      <div className="flex gap-4 px-4 mb-8 relative z-10">
        <Button
          className="flex-1 bg-gradient-to-r from-emerald to-emerald-dark hover:from-emerald-dark hover:to-emerald text-white font-bold py-4 rounded-2xl disabled:from-charcoal disabled:to-charcoal-dark disabled:text-gray-600 transition-all duration-300 hover:scale-[1.02] shadow-xl hover:shadow-2xl border border-emerald/20"
          onClick={() => handleAddPlayer(true)}
          disabled={
            roomState.status === "spinning" ||
            roomState.status === "finished" ||
            (roomState.status === "countdown" && roomState.countdown <= 3)
          }
        >
          <div className="flex items-center justify-center gap-3">
            <div className="p-1 bg-white/10 rounded-full">
              <Plus className="w-5 h-5 text-emerald-light" />
            </div>
            <span className="text-lg">Добавить гифт</span>
            <Sparkles className="w-5 h-5 text-gold" />
          </div>
        </Button>

        <Button
          className={`flex-1 font-bold py-4 rounded-2xl flex items-center justify-center transition-all duration-300 hover:scale-[1.02] shadow-xl hover:shadow-2xl border border-gold/20 ${
            roomState.status === "countdown" && roomState.countdown <= 3
              ? "bg-gradient-to-r from-charcoal to-charcoal-dark text-gray-600 cursor-not-allowed"
              : "bg-gradient-to-r from-gold to-gold-dark hover:from-gold-dark hover:to-gold text-charcoal-dark"
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
          <div className="flex items-center justify-center gap-3">
            <span className="text-3xl">🎁</span>
            <div className="text-center">
              <div className={`font-bold ${tonButtonFontSizeClass}`}>Добавить {displayedTonAmount} ТОН</div>
            </div>
            <div className="w-6 h-6 bg-white/10 rounded-full flex items-center justify-center">
              <span className="text-gold text-xs">₮</span>
            </div>
          </div>
        </Button>
      </div>

      {/* Кнопка сброса для тестирования */}
      <div className="flex justify-center mb-8 relative z-10">
        <Button
          className="bg-charcoal/50 hover:bg-charcoal/70 border border-charcoal-light/20 backdrop-blur-lg text-white font-bold py-3 px-6 rounded-2xl transition-all duration-300 hover:scale-[1.02] shadow-lg hover:shadow-xl"
          onClick={handleResetRoom}
        >
          Сбросить комнату (для теста)
        </Button>
      </div>

      {/* Эмодзи навигация */}
      <div className="flex justify-center gap-6 mb-8 relative z-10">
        {items.map((item, index) => (
          <Button
            key={index}
            variant="ghost"
            className="flex flex-col items-center gap-2 text-gray-500 hover:text-white py-4 px-4 rounded-2xl hover:bg-charcoal/20 transition-all duration-300 hover:scale-105"
            onClick={() => hapticFeedback.selection()}
          >
            <div className="text-2xl p-2 bg-charcoal/30 rounded-xl backdrop-blur-sm border border-charcoal-light/20">
              {item.icon}
            </div>
            <span className="text-xs font-medium">{item.label}</span>
          </Button>
        ))}
      </div>

      {/* Список игроков */}
      <div className="px-4 mb-8 relative z-10">
        {participants.length === 0 ? (
          <Card className="bg-charcoal/30 backdrop-blur-lg border-charcoal-light/20 p-6 text-center mb-4 rounded-3xl shadow-xl">
            <div className="w-16 h-16 bg-gradient-to-r from-charcoal to-charcoal-dark rounded-full mx-auto mb-4 flex items-center justify-center">
              <Users className="w-8 h-8 text-gray-600" />
            </div>
            <p className="text-gray-500 text-lg">Нет участников</p>
            <p className="text-gray-600 text-sm mt-2">Добавьте гифт, чтобы начать игру</p>
          </Card>
        ) : (
          participants.map((player, index) => (
            <div key={player.id} className="mb-4">
              <Card className="bg-charcoal/30 backdrop-blur-lg border-charcoal-light/20 p-5 rounded-3xl shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-[1.01]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <img
                        src={player.avatar || "/placeholder.svg"}
                        alt="Player"
                        className="w-12 h-12 rounded-full object-cover shadow-lg"
                        style={{
                          border: `3px solid ${player.color}`,
                          boxShadow: `0 0 15px ${player.color}40`,
                        }}
                      />
                      <div
                        className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center border-2 border-charcoal-dark"
                        style={{ backgroundColor: player.color }}
                      >
                        <span className="text-white text-xs font-bold">#{index + 1}</span>
                      </div>
                    </div>
                    <div>
                      <span className="text-white font-bold text-lg">{player.displayName}</span>
                      <div className="text-gray-400 text-sm">Участник игры</div>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="bg-charcoal/20 backdrop-blur-sm text-white px-4 py-2 rounded-2xl text-sm font-bold border border-charcoal-light/20">
                      {player.percentage.toFixed(player.percentage < 10 ? 2 : 0)}%
                    </div>
                    <div className="bg-gold/20 backdrop-blur-sm text-white px-4 py-2 rounded-2xl text-sm font-bold border border-gold/30 flex items-center gap-2">
                      <span>{player.tonValue.toFixed(1)} ТОН</span>
                      <div className="w-4 h-4 bg-gradient-to-r from-gold to-gold-dark rounded-full flex items-center justify-center">
                        <span className="text-charcoal-dark text-xs">₮</span>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          ))
        )}
      </div>

      {/* Модал победителя */}
      {showWinnerModal && currentWinner && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <Card className="bg-gradient-to-br from-darkblue-dark/90 to-charcoal-dark/90 backdrop-blur-xl border-gold/20 p-8 rounded-3xl max-w-sm w-full text-center relative shadow-2xl modal-enter">
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-4 right-4 text-gray-500 hover:text-white bg-charcoal/50 rounded-full w-10 h-10"
              onClick={() => setShowWinnerModal(false)}
            >
              <X className="w-5 h-5" />
            </Button>
            <div className="text-6xl mb-6 text-gold animate-glow-subtle">
              <Trophy className="w-20 h-20 mx-auto" />
            </div>
            <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-gold-light to-gold mb-4">
              Победитель!
            </h2>
            <div className="relative mb-6">
              <img
                src={currentWinner.avatar || "/placeholder.svg"}
                alt="Winner"
                className="w-20 h-20 rounded-full mx-auto object-cover shadow-2xl border-4 border-gold"
                style={{ boxShadow: `0 0 40px ${currentWinner.color}60` }}
              />
              <div className="absolute -top-2 -right-2 w-8 h-8 bg-gradient-to-r from-gold to-gold-dark rounded-full flex items-center justify-center animate-spin">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
            </div>
            <div className="text-xl text-white mb-4 font-bold">{currentWinner.displayName}</div>
            <div className="bg-emerald/20 backdrop-blur-sm border border-emerald/30 rounded-2xl p-4 mb-4">
              <div className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-light to-emerald">
                Выиграл {(roomState.total_ton ?? 0).toFixed(1)} ТОН
              </div>
            </div>
            <div className="text-sm text-gray-400">
              Шанс победы: <span className="text-white font-bold">{currentWinner.percentage.toFixed(1)}%</span>
            </div>
          </Card>
        </div>
      )}

      {/* Нижняя навигация */}
      <div className="fixed left-0 right-0 bottom-0 bg-charcoal-dark/80 backdrop-blur-xl border-t border-charcoal-light/20 z-50">
        <div className="flex justify-around py-3">
          {items.map((item, index) => (
            <Button
              key={index}
              variant="ghost"
              className="flex flex-col items-center gap-2 text-gray-500 hover:text-white py-4 px-4 rounded-2xl hover:bg-charcoal/20 transition-all duration-300"
              onClick={() => hapticFeedback.selection()}
            >
              <div className="text-xl p-2 bg-charcoal/30 rounded-xl backdrop-blur-sm border border-charcoal-light/20">
                {item.icon}
              </div>
              <span className="text-xs font-medium">{item.label}</span>
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
