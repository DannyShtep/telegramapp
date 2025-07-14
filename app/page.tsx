"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Plus, Eye, RotateCcw, Trophy } from "lucide-react"
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
} from "@/app/actions"
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

export default function TelegramRouletteApp() {
  const { user, isReady, hapticFeedback, getUserPhotoUrl, getUserDisplayName, showAlert } = useTelegram()
  const supabase = createClientComponentClient()

  const defaultRoomId = "default-room-id"

  const [roomState, setRoomState] = useState<RoomState | null>(null)
  const [playersInRoom, setPlayersInRoom] = useState<Player[]>([])
  const [rotation, setRotation] = useState(0)
  const [showWinnerModal, setShowWinnerModal] = useState(false)
  const [displayedTonAmount, setDisplayedTonAmount] = useState(Math.floor(Math.random() * 20 + 5))

  const playerColors = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#F9CA24", "#6A89CC", "#FD79A8", "#F0932B", "#EB4D4B"]

  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const spinTimeoutRef = useRef<NodeJS.Timeout | null>(null)

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
      color: isParticipant ? playerColors[existingPlayersCount % playerColors.length] : "#A9A9A9",
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

    if (roomState.status === "countdown" && roomState.countdown > 0) {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)

      countdownIntervalRef.current = setInterval(async () => {
        setRoomState((prev) => {
          if (!prev || prev.countdown <= 0) return prev
          const newCountdown = prev.countdown - 1

          if (newCountdown <= 3 && newCountdown > 0) hapticFeedback.impact("heavy")

          if (newCountdown === 0) {
            const winner = selectWinner(participants)
            const winnerTelegramId = winner ? winner.telegramId : null

            const randomRotation = 5400 + Math.random() * 1440
            setRotation((prevRot) => prevRot + randomRotation)
            hapticFeedback.impact("heavy")
            updateRoomState(defaultRoomId, {
              status: "spinning",
              countdown: 0,
              winner_telegram_id: winnerTelegramId,
            })

            if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current)
            spinTimeoutRef.current = setTimeout(async () => {
              if (winnerTelegramId) {
                setShowWinnerModal(true)
                hapticFeedback.notification("success")
              }
              await updateRoomState(defaultRoomId, { status: "finished" })
            }, 15000)
          } else {
            updateRoomState(defaultRoomId, { countdown: newCountdown })
          }
          return { ...prev, countdown: newCountdown }
        })
      }, 1000)
    } else if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = null
    }

    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
      if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current)
    }
  }, [roomState, playersInRoom, hapticFeedback])

  const selectWinner = (participants: Player[]): Player | null => {
    if (participants.length === 0) return null

    const totalTon = participants.reduce((sum, p) => sum + p.tonValue, 0)
    if (totalTon === 0) return participants[Math.floor(Math.random() * participants.length)]

    const randomValue = Math.random() * totalTon
    let cumulativeTon = 0

    for (const player of participants) {
      cumulativeTon += player.tonValue
      if (randomValue <= cumulativeTon) {
        return player
      }
    }
    return participants[participants.length - 1]
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

        const tonValue = isGift ? Math.floor(Math.random() * 20 + 5) : tonAmountToAdd!
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

  const handleResetRoom = async () => {
    if (!roomState) return
    const confirmed = await showAlert("Вы уверены, что хотите сбросить комнату? Все игроки и ставки будут удалены.")
    if (confirmed) {
      hapticFeedback.impact("heavy")
      await resetRoom(roomState.id)
      setRotation(0)
      setShowWinnerModal(false)
    }
  }

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
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200">
        <div className="text-center p-8 bg-white dark:bg-gray-800 rounded-lg shadow-md">
          <p>Supabase не настроен. Добавьте переменные окружения или разверните на Vercel.</p>
        </div>
      </div>
    )
  }

  if (!isReady || !roomState) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  const currentWinner = roomState.winner_telegram_id
    ? playersInRoom.find((p) => p.telegramId === roomState.winner_telegram_id)
    : null

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200 p-4 flex flex-col">
      <header className="flex justify-between items-center mb-4">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" onClick={() => hapticFeedback.selection()}>
              <Eye className="w-4 h-4 mr-2" />
              Онлайн: {playersInRoom.length}
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-md">
            <DialogHeader>
              <DialogTitle>Онлайн игроки</DialogTitle>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto">
              {playersInRoom.map((player) => (
                <div key={player.id} className="flex items-center gap-3 p-2 rounded-lg">
                  <img
                    src={player.avatar || "/placeholder.svg"}
                    alt="Player"
                    className="w-10 h-10 rounded-full"
                    style={{ border: `2px solid ${player.isParticipant ? player.color : "#ccc"}` }}
                  />
                  <span>{player.displayName}</span>
                  {player.isParticipant && <span className="text-xs text-green-500">(Участник)</span>}
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
        {user && (
          <div className="flex items-center gap-2">
            <img src={getUserPhotoUrl(user) || "/placeholder.svg"} alt="Avatar" className="w-8 h-8 rounded-full" />
            <span className="text-sm font-medium">{getUserDisplayName(user)}</span>
          </div>
        )}
        <Button variant="ghost" size="icon" onClick={handleResetRoom}>
          <RotateCcw className="w-4 h-4" />
        </Button>
      </header>

      <main className="flex-grow flex flex-col items-center justify-center">
        <div className="text-center mb-4">
          <h1 className="text-2xl font-bold">Общий банк</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            {formatGiftsText(roomState.total_gifts)} / {(roomState.total_ton ?? 0).toFixed(2)} TON
          </p>
        </div>

        <div className="relative w-80 h-80 md:w-96 md:h-96 mb-8">
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 w-4 h-4 bg-red-500 rounded-full z-10"
            style={{ top: "-8px" }}
          ></div>
          <div
            className="w-full h-full rounded-full relative"
            style={{
              transform: `rotate(${rotation}deg)`,
              transition: roomState.status === "spinning" ? "transform 15s cubic-bezier(0.25, 0.1, 0.25, 1)" : "none",
            }}
          >
            {participants.length === 0 ? (
              <div className="w-full h-full bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center">
                <span className="text-gray-500">Ожидание игроков</span>
              </div>
            ) : (
              <svg className="w-full h-full" viewBox="0 0 200 200">
                {segments.map((segment, index) => {
                  const startAngleRad = (segment.startAngle * Math.PI) / 180
                  const endAngleRad = (segment.endAngle * Math.PI) / 180
                  const largeArcFlag = segment.angle > 180 ? 1 : 0
                  const x1 = 100 + 100 * Math.cos(startAngleRad)
                  const y1 = 100 + 100 * Math.sin(startAngleRad)
                  const x2 = 100 + 100 * Math.cos(endAngleRad)
                  const y2 = 100 + 100 * Math.sin(endAngleRad)
                  const pathData = `M 100 100 L ${x1} ${y1} A 100 100 0 ${largeArcFlag} 1 ${x2} ${y2} Z`
                  return <path key={index} d={pathData} fill={segment.player.color} />
                })}
              </svg>
            )}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 bg-white dark:bg-gray-800 rounded-full flex items-center justify-center text-center">
              {roomState.status === "countdown" ? (
                <span className="text-3xl font-bold">{roomState.countdown}</span>
              ) : (
                <span className="text-sm text-gray-500">{roomState.status === "spinning" ? "Крутим!" : "Старт"}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-4 mb-4">
          <Button
            onClick={() => handleAddPlayer(true)}
            disabled={
              roomState.status === "spinning" ||
              roomState.status === "finished" ||
              (roomState.status === "countdown" && roomState.countdown <= 3)
            }
          >
            <Plus className="mr-2 h-4 w-4" /> Добавить гифт
          </Button>
          <Button
            variant="secondary"
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
            Добавить {displayedTonAmount} TON
          </Button>
        </div>
      </main>

      <footer className="w-full max-w-md mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Участники</CardTitle>
          </CardHeader>
          <CardContent className="max-h-48 overflow-y-auto">
            {participants.length === 0 ? (
              <p className="text-sm text-gray-500">Нет участников. Добавьте гифт, чтобы начать.</p>
            ) : (
              participants.map((player) => (
                <div
                  key={player.id}
                  className="flex items-center justify-between p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: player.color }}></div>
                    <img src={player.avatar || "/placeholder.svg"} alt="avatar" className="w-6 h-6 rounded-full" />
                    <span>{player.displayName}</span>
                  </div>
                  <span className="text-sm font-medium">
                    {player.percentage.toFixed(2)}% ({player.tonValue.toFixed(2)} TON)
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </footer>

      {showWinnerModal && currentWinner && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <Card className="w-full max-w-sm text-center p-6">
            <CardHeader>
              <div className="mx-auto bg-yellow-400 rounded-full p-3 w-fit">
                <Trophy className="w-8 h-8 text-white" />
              </div>
              <CardTitle className="mt-4">Победитель!</CardTitle>
            </CardHeader>
            <CardContent>
              <img
                src={currentWinner.avatar || "/placeholder.svg"}
                alt="Winner"
                className="w-20 h-20 rounded-full mx-auto mb-4 border-4"
                style={{ borderColor: currentWinner.color }}
              />
              <p className="text-lg font-semibold">{currentWinner.displayName}</p>
              <p className="text-xl font-bold text-green-500 mt-2">
                Выиграл {(roomState.total_ton ?? 0).toFixed(2)} TON
              </p>
              <p className="text-sm text-gray-500 mt-1">Шанс победы: {currentWinner.percentage.toFixed(2)}%</p>
              <Button className="mt-6" onClick={() => setShowWinnerModal(false)}>
                Закрыть
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
