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
  const { user, isReady, hapticFeedback, getUserPhotoUrl, getUserDisplayName, showAlert, showConfirm } = useTelegram()
  const supabase = createClientComponentClient()

  const defaultRoomId = "default-room-id"

  const [roomState, setRoomState] = useState<RoomState | null>(null)
  const [playersInRoom, setPlayersInRoom] = useState<Player[]>([])
  const [rotation, setRotation] = useState(0)
  const [showWinnerModal, setShowWinnerModal] = useState(false)
  const [displayedTonAmount, setDisplayedTonAmount] = useState(9)

  const playerColors = ["#8B5CF6", "#38bdf8", "#34d399", "#fbbf24", "#f472b6", "#818cf8"]

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
      color: isParticipant ? playerColors[existingPlayersCount % playerColors.length] : "#94a3b8",
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
        if (room) setRoomState(room)

        const userAvatar = getUserPhotoUrl(user)
        const userDisplayName = getUserDisplayName(user)

        await ensureUserOnline(defaultRoomId, user.id, user.username, userAvatar, userDisplayName)
        const { players } = await getPlayersInRoom(defaultRoomId)
        if (players) setPlayersInRoom(players)
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
        (payload) => setRoomState(payload.new as RoomState),
      )
      .subscribe()

    const playerSubscription = supabase
      .channel(`players_in_room:${defaultRoomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `room_id=eq.${defaultRoomId}` },
        async () => {
          const { players } = await getPlayersInRoom(defaultRoomId)
          if (players) setPlayersInRoom(players)
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

    if (JSON.stringify(playersNext) !== JSON.stringify(playersInRoom)) {
      setPlayersInRoom(playersNext)
    }

    if (roomState.status === "countdown" && roomState.countdown > 0) {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)

      countdownIntervalRef.current = setInterval(() => {
        setRoomState((prev) => {
          if (!prev || prev.countdown <= 1) {
            clearInterval(countdownIntervalRef.current!)
            const winner = selectWinner(participants)
            const winnerTelegramId = winner ? winner.telegramId : null
            const randomRotation = 3600 + Math.random() * 360
            setRotation((prevRot) => prevRot + randomRotation)
            hapticFeedback.impact("heavy")
            updateRoomState(defaultRoomId, { status: "spinning", countdown: 0, winner_telegram_id: winnerTelegramId })

            if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current)
            spinTimeoutRef.current = setTimeout(async () => {
              if (winnerTelegramId) {
                setShowWinnerModal(true)
                hapticFeedback.notification("success")
              }
              await updateRoomState(defaultRoomId, { status: "finished" })
            }, 8000) // Spin duration
            return { ...prev, status: "spinning", countdown: 0, winner_telegram_id: winnerTelegramId }
          }
          const newCountdown = prev.countdown - 1
          if (newCountdown <= 3) hapticFeedback.impact("heavy")
          updateRoomState(defaultRoomId, { countdown: newCountdown })
          return { ...prev, countdown: newCountdown }
        })
      }, 1000)
    } else if (roomState.status !== "countdown" && countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
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
      if (randomValue <= cumulativeTon) return player
    }
    return participants[participants.length - 1]
  }

  const handleAddPlayer = useCallback(
    async (isGift = true, tonAmountToAdd?: number) => {
      if (!user || !roomState || !supabase) return
      const isGameActive =
        roomState.status === "spinning" ||
        roomState.status === "finished" ||
        (roomState.status === "countdown" && roomState.countdown <= 3)
      if (isGameActive) {
        showAlert("Игра уже идет или вот-вот начнется!")
        hapticFeedback.notification("error")
        return
      }
      if (playersInRoom.some((p) => p.telegramId === user.id && p.isParticipant)) {
        showAlert("Вы уже участвуете в игре!")
        hapticFeedback.notification("error")
        return
      }

      const tonValue = isGift ? 7 : tonAmountToAdd!
      const newPlayer = createPlayerObject(user, true, tonValue, playersInRoom.filter((p) => p.isParticipant).length)
      hapticFeedback.impact("medium")
      const { player, error } = await addPlayerToRoom(roomState.id, newPlayer)
      if (error || !player) {
        showAlert(`Ошибка: ${error || "Не удалось добавить игрока."}`)
        return
      }

      const updatedParticipants = [...playersInRoom.filter((p) => p.isParticipant), player]
      const newTotalTon = updatedParticipants.reduce((sum, p) => sum + p.tonValue, 0)
      const newTotalGifts = updatedParticipants.length
      const newStatus = newTotalGifts >= 2 ? "countdown" : "single_player"
      await updateRoomState(roomState.id, {
        total_gifts: newTotalGifts,
        total_ton: newTotalTon,
        status: newStatus,
        countdown: 20,
      })
    },
    [user, roomState, playersInRoom, hapticFeedback, supabase, showAlert],
  )

  const handleResetRoom = async () => {
    if (!roomState) return
    const confirmed = await showConfirm("Вы уверены, что хотите сбросить комнату?")
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
      const segment = { player, startAngle: currentAngle, endAngle: currentAngle + segmentAngle, angle: segmentAngle }
      currentAngle += segmentAngle
      return segment
    })
  }

  const segments = getWheelSegments()
  const participants = playersInRoom.filter((p) => p.isParticipant)
  const currentWinner = roomState?.winner_telegram_id
    ? playersInRoom.find((p) => p.telegramId === roomState.winner_telegram_id)
    : null

  if (!isReady || !roomState) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-transparent">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-transparent text-foreground flex flex-col p-4 pb-40">
      <header className="flex justify-between items-center mb-6">
        <Button variant="secondary" size="sm" className="h-10 px-4">
          <Eye className="w-4 h-4 mr-2" />
          Онлайн: {playersInRoom.length}
        </Button>
        {user && (
          <div className="flex items-center gap-2">
            <img
              src={getUserPhotoUrl(user) || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}`}
              alt="Avatar"
              className="w-8 h-8 rounded-full"
            />
            <span className="text-sm font-semibold">{getUserDisplayName(user)}</span>
          </div>
        )}
        <Button variant="ghost" size="icon" onClick={handleResetRoom}>
          <RotateCcw className="w-5 h-5" />
        </Button>
      </header>

      <main className="flex-grow flex flex-col items-center justify-center">
        <div className="text-center mb-8">
          <p className="text-lg text-muted-foreground">
            {roomState?.total_gifts ?? 0} {(roomState?.total_gifts ?? 0) === 1 ? "подарок" : "подарка"} /{" "}
            <span className="font-bold text-foreground">{(roomState?.total_ton ?? 0).toFixed(2)} TON</span>
          </p>
        </div>

        <div className="relative w-72 h-72 md:w-80 md:h-80">
          <div className="absolute -top-4 left-1/2 -translate-x-1/2 w-0 h-0 border-l-8 border-r-8 border-b-8 border-l-transparent border-r-transparent border-b-red-500"></div>
          <div
            className="w-full h-full rounded-full relative"
            style={{
              transform: `rotate(${rotation}deg)`,
              transition: roomState.status === "spinning" ? "transform 8s cubic-bezier(0.25, 1, 0.5, 1)" : "none",
            }}
          >
            <div className="absolute inset-0 rounded-full bg-gray-700/50">
              {participants.length > 0 ? (
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
              ) : null}
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-32 h-32 bg-card/70 backdrop-blur-sm rounded-full flex items-center justify-center text-center shadow-inner">
                {roomState.status === "countdown" ? (
                  <span className="text-5xl font-bold text-foreground">{roomState.countdown}</span>
                ) : (
                  <span className="text-xl font-semibold text-muted-foreground">
                    {roomState.status === "spinning" ? "Крутим!" : "Старт"}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 mt-10">
          <Button
            size="lg"
            className="bg-primary text-primary-foreground font-bold h-14 px-8 text-base"
            onClick={() => handleAddPlayer(true)}
            disabled={!roomState}
          >
            <Plus className="mr-2 h-5 w-5" /> Добавить гифт
          </Button>
          <Button
            size="lg"
            variant="secondary"
            className="font-bold h-14 px-8 text-base"
            onClick={() => handleAddPlayer(false, displayedTonAmount)}
            disabled={!roomState}
          >
            Добавить {displayedTonAmount} TON
          </Button>
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 p-2">
        <Card className="w-full max-w-xl mx-auto shadow-2xl bg-card text-card-foreground">
          <CardHeader className="p-4">
            <CardTitle>Участники</CardTitle>
          </CardHeader>
          <CardContent className="max-h-32 overflow-y-auto px-4 pb-4 pt-0">
            {participants.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Нет участников. Добавьте гифт, чтобы начать.
              </p>
            ) : (
              <div className="space-y-2">
                {participants.map((player) => (
                  <div key={player.id} className="flex items-center justify-between p-2 rounded-lg bg-white/5">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: player.color }}></div>
                      <img
                        src={player.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${player.telegramId}`}
                        alt="avatar"
                        className="w-6 h-6 rounded-full"
                      />
                      <span className="text-sm font-medium">{player.displayName}</span>
                    </div>
                    <span className="text-sm font-medium">{player.percentage.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {showWinnerModal && currentWinner && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-sm text-center p-6 bg-card border-primary/20 shadow-2xl">
            <CardHeader>
              <div className="mx-auto bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full p-3 w-fit">
                <Trophy className="w-8 h-8 text-white" />
              </div>
              <CardTitle className="mt-4 text-2xl">Победитель!</CardTitle>
            </CardHeader>
            <CardContent>
              <img
                src={
                  currentWinner.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${currentWinner.telegramId}`
                }
                alt="Winner"
                className="w-24 h-24 rounded-full mx-auto mb-4 border-4"
                style={{ borderColor: currentWinner.color }}
              />
              <p className="text-xl font-semibold">{currentWinner.displayName}</p>
              <p className="text-2xl font-bold text-green-400 mt-2">
                Выиграл {(roomState.total_ton ?? 0).toFixed(2)} TON
              </p>
              <Button
                className="mt-6 w-full bg-primary text-primary-foreground"
                onClick={() => setShowWinnerModal(false)}
              >
                Закрыть
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}