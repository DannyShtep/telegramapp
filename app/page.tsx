"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Plus, X, Eye, Users } from "lucide-react"
import { useTelegram } from "../hooks/useTelegram"
import type { TelegramUser } from "../types/telegram"

interface Player {
  id: string
  telegramId: number
  username: string
  displayName: string
  avatar: string
  gifts: number
  tonValue: number
  color: string
  percentage: number
  isParticipant: boolean
  // isPremium?: boolean // Удалено
}

interface GameState {
  status: "waiting" | "single_player" | "countdown" | "spinning" | "finished"
  players: Player[]
  totalGifts: number
  totalTon: number
  countdown: number
  winner: Player | null
}

export default function TelegramRouletteApp() {
  const { user, isReady, hapticFeedback, showAlert, getUserPhotoUrl, getUserDisplayName } = useTelegram()

  const [gameState, setGameState] = useState<GameState>({
    status: "waiting",
    players: [],
    totalGifts: 0,
    totalTon: 0,
    countdown: 20,
    winner: null,
  })

  const [rotation, setRotation] = useState(0)
  const [showWinnerModal, setShowWinnerModal] = useState(false)
  const [showPlayersModal, setShowPlayersModal] = useState(false)
  const [displayedTonAmount, setDisplayedTonAmount] = useState(Math.floor(Math.random() * 20 + 5))

  // Список всех игроков в комнате (включая наблюдателей)
  const [allPlayersInRoom, setAllPlayersInRoom] = useState<Player[]>([])

  const playerColors = ["#ef4444", "#22c55e", "#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899"]

  // Функция для создания игрока из Telegram пользователя
  const createPlayerFromTelegramUser = (telegramUser: TelegramUser, isParticipant = false, tonValue = 0): Player => {
    const participantCount = gameState.players.filter((p) => p.isParticipant).length

    return {
      id: `player_${telegramUser.id}`,
      telegramId: telegramUser.id,
      username: telegramUser.username || `user${telegramUser.id}`,
      displayName: getUserDisplayName(telegramUser),
      avatar: getUserPhotoUrl(telegramUser),
      gifts: isParticipant ? 1 : 0,
      tonValue,
      color: isParticipant ? playerColors[participantCount % playerColors.length] : "",
      percentage: 0,
      isParticipant,
      // isPremium: telegramUser.is_premium, // Удалено
    }
  }

  // Инициализация наблюдателей при загрузке
  useEffect(() => {
    if (!isReady) return

    // Моковые данные других пользователей в комнате
    const mockTelegramUsers: TelegramUser[] = [
      {
        id: 123456789,
        first_name: "Alex",
        last_name: "Crypto",
        username: "alexkrypto",
        language_code: "ru",
        // is_premium: true, // Удалено
      },
      {
        id: 987654321,
        first_name: "Maria",
        username: "mariaweb3",
        language_code: "en",
        // is_premium: false, // Удалено
      },
      {
        id: 456789123,
        first_name: "Crypto",
        last_name: "King",
        username: "cryptoking",
        language_code: "ru",
        // is_premium: true, // Удалено
      },
      {
        id: 789123456,
        first_name: "NFT",
        last_name: "Queen",
        username: "nftqueen",
        language_code: "en",
        // is_premium: false, // Удалено
      },
      {
        id: 321654987,
        first_name: "Ton",
        last_name: "Master",
        username: "tonmaster",
        language_code: "ru",
        // is_premium: true, // Удалено
      },
    ]

    const mockObservers = mockTelegramUsers.map((telegramUser) => createPlayerFromTelegramUser(telegramUser, false))

    // Добавляем текущего пользователя как наблюдателя, если он есть
    if (user) {
      const currentUserAsObserver = createPlayerFromTelegramUser(user, false)
      setAllPlayersInRoom([currentUserAsObserver, ...mockObservers])
    } else {
      setAllPlayersInRoom(mockObservers)
    }
  }, [isReady, user])

  const addPlayer = useCallback(
    (isGift = true, tonAmountToAdd?: number) => {
      if (!user) {
        showAlert("Ошибка: не удалось получить данные пользователя Telegram")
        return
      }

      if (gameState.status === "countdown" && gameState.countdown <= 3) return
      if (gameState.status === "spinning" || gameState.status === "finished") return

      // Проверяем, не участвует ли уже пользователь
      const existingPlayer = gameState.players.find((p) => p.telegramId === user.id)
      if (existingPlayer) {
        hapticFeedback.notification("error")
        showAlert("Вы уже участвуете в игре!")
        return
      }

      const tonValue = isGift ? Math.random() * 20 + 5 : tonAmountToAdd!
      const newPlayer = createPlayerFromTelegramUser(user, true, tonValue)

      // Haptic feedback при добавлении
      hapticFeedback.impact("medium")

      setGameState((prev) => {
        const updatedPlayers = [...prev.players, newPlayer]
        const participants = updatedPlayers.filter((p) => p.isParticipant)
        const newTotalTon = participants.reduce((sum, p) => sum + p.tonValue, 0)
        const newTotalGifts = participants.length

        // Пересчитываем проценты только для участников
        const playersWithPercentages = updatedPlayers.map((player) => ({
          ...player,
          percentage: player.isParticipant ? (player.tonValue / newTotalTon) * 100 : 0,
        }))

        const newStatus =
          participants.length === 1 ? "single_player" : participants.length >= 2 ? "countdown" : "waiting"

        return {
          ...prev,
          players: playersWithPercentages,
          totalGifts: newTotalGifts,
          totalTon: newTotalTon,
          status: newStatus,
        }
      })

      // Обновляем игрока в общем списке комнаты
      setAllPlayersInRoom((prev) =>
        prev.map((p) => (p.telegramId === user.id ? { ...newPlayer, isParticipant: true } : p)),
      )
    },
    [gameState.status, gameState.countdown, gameState.players, user, hapticFeedback, showAlert],
  )

  // Таймер обратного отсчета
  useEffect(() => {
    let interval: NodeJS.Timeout

    if (gameState.status === "countdown" && gameState.countdown > 0) {
      interval = setInterval(() => {
        setGameState((prev) => {
          const newCountdown = prev.countdown - 1

          // Haptic feedback на последних секундах
          if (newCountdown <= 3 && newCountdown > 0) {
            hapticFeedback.impact("heavy")
          }

          if (newCountdown === 0) {
            // Запускаем рулетку
            const randomRotation = 5400 + Math.random() * 1440
            setRotation((prev) => prev + randomRotation)

            // Haptic feedback при запуске
            hapticFeedback.impact("heavy")

            // Определяем победителя через 15 секунд
            setTimeout(() => {
              const participants = prev.players.filter((p) => p.isParticipant)
              const randomValue = Math.random() * prev.totalTon
              let currentSum = 0
              const winner =
                participants.find((player) => {
                  currentSum += player.tonValue
                  return randomValue <= currentSum
                }) || participants[0]

              setGameState((current) => ({
                ...current,
                status: "finished",
                winner,
              }))
              setShowWinnerModal(true)

              // Haptic feedback для победителя
              if (winner?.telegramId === user?.id) {
                hapticFeedback.notification("success")
              } else {
                hapticFeedback.notification("error")
              }

              // Автоматически закрываем модал через 6 секунд
              setTimeout(() => {
                setShowWinnerModal(false)
                setTimeout(() => {
                  setGameState({
                    status: "waiting",
                    players: [],
                    totalGifts: 0,
                    totalTon: 0,
                    countdown: 20,
                    winner: null,
                  })
                  setRotation(0)
                  setDisplayedTonAmount(Math.floor(Math.random() * 20 + 5))
                }, 1000)
              }, 6000)
            }, 15000)

            return {
              ...prev,
              status: "spinning",
              countdown: 0,
            }
          }

          return {
            ...prev,
            countdown: newCountdown,
          }
        })
      }, 1000)
    }

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [gameState.status, gameState.countdown, hapticFeedback, user])

  const getWheelSegments = () => {
    const participants = gameState.players.filter((p) => p.isParticipant)
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
  const participants = gameState.players.filter((p) => p.isParticipant)
  // const observers = allPlayersInRoom.filter((p) => !p.isParticipant) // Больше не используется отдельно

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

  // Показываем загрузку пока не готов Telegram
  if (!isReady) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-400 mx-auto mb-4"></div>
          <p className="text-gray-400">Подключение к Telegram...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-black text-white relative overflow-x-hidden mobile-content-padding">
      {/* Верхние элементы UI: Счетчик игроков и Информация о текущем пользователе */}
      <div className="absolute top-4 left-4 right-4 z-20 flex justify-between items-center gap-2">
        {/* Счетчик игроков в комнате */}
        <Button
          variant="ghost"
          size="sm"
          className="bg-black/60 hover:bg-black/80 border border-gray-600 backdrop-blur-sm text-white h-10 px-4 py-2 rounded-lg flex items-center justify-center"
          onClick={() => {
            hapticFeedback.selection()
            setShowPlayersModal(true)
          }}
        >
          <Eye className="w-4 h-4 mr-2" />
          <span className="text-sm whitespace-nowrap">Игроков: {allPlayersInRoom.length}</span>
        </Button>

        {/* Информация о текущем пользователе */}
        {user && (
          <div className="bg-black/60 border border-gray-600 backdrop-blur-sm rounded-lg px-3 py-2 flex items-center gap-2 h-10">
            <img src={getUserPhotoUrl(user) || "/placeholder.svg"} alt="Avatar" className="w-6 h-6 rounded-full" />
            <span className="text-sm text-white whitespace-nowrap">{getUserDisplayName(user)}</span>
            {/* {user.is_premium && <span className="text-xs text-yellow-400">⭐</span>} // Удалено */}
          </div>
        )}
      </div>

      {/* Общий банк */}
      <div className="flex items-center justify-center mb-4 pt-16 relative z-10">
        <div className="flex items-center gap-2 text-green-400">
          <div className="w-2 h-2 bg-green-400 rounded-full"></div>
          <span className="text-lg font-medium">Общий банк</span>
        </div>
      </div>

      {/* Счетчик подарков и TON */}
      <div className="flex justify-center mb-8 relative z-10">
        <div className="border border-gray-600 px-6 py-3 rounded-xl font-medium text-lg">
          {formatGiftsText(gameState.totalGifts)} | {gameState.totalTon.toFixed(1)} ТОН
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
            transition: gameState.status === "spinning" ? "transform 15s cubic-bezier(0.25, 0.1, 0.25, 1)" : "none",
          }}
        >
          {gameState.status === "waiting" ? (
            <div className="w-full h-full bg-gray-600 rounded-full relative">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 bg-black rounded-full flex items-center justify-center border-0">
                <span className="text-gray-300 text-sm font-medium">Ожидание</span>
              </div>
            </div>
          ) : gameState.status === "single_player" ? (
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
                        href={segment.player.avatar}
                        clipPath="circle(8px at center)"
                      />
                    </g>
                  )
                })}
              </svg>

              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 bg-black rounded-full flex items-center justify-center border-0">
                {gameState.status === "countdown" ? (
                  <span className="text-gray-300 text-lg font-mono">
                    {String(Math.floor(gameState.countdown / 60)).padStart(2, "0")}:
                    {String(gameState.countdown % 60).padStart(2, "0")}
                  </span>
                ) : (
                  <span className="text-gray-300 text-sm font-medium">
                    {gameState.status === "spinning" ? "Крутим!" : "Ожидание"}
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
          onClick={() => addPlayer(true)}
          disabled={
            gameState.status === "spinning" ||
            gameState.status === "finished" ||
            (gameState.status === "countdown" && gameState.countdown <= 3)
          }
        >
          <Plus className="w-5 h-5 mr-2" />
          Добавить гифт
        </Button>

        <Button
          className={`flex-1 font-medium py-3 rounded-xl flex items-center justify-center ${
            gameState.status === "countdown" && gameState.countdown <= 3
              ? "bg-gray-600 text-gray-400 cursor-not-allowed"
              : "bg-green-400 hover:bg-green-500 text-black"
          }`}
          onClick={() => {
            addPlayer(false, displayedTonAmount)
            setDisplayedTonAmount(Math.floor(Math.random() * 20 + 5))
          }}
          disabled={
            gameState.status === "spinning" ||
            gameState.status === "finished" ||
            (gameState.status === "countdown" && gameState.countdown <= 3)
          }
        >
          <span className="text-2xl mr-2 flex-shrink-0">🎁</span>
          <span className={`whitespace-nowrap ${tonButtonFontSizeClass}`}>Добавить {displayedTonAmount} ТОН</span>
        </Button>
      </div>

      {/* Эмодзи */}
      <div className="flex justify-center gap-4 mb-6 relative z-10">
        {["🏠", "😢", "💀", "😂", "💩", "🤡"].map((emoji, index) => (
          <Button
            key={index}
            variant="ghost"
            size="icon"
            className="w-12 h-12 bg-black/40 hover:bg-black/60 rounded-full text-xl"
            onClick={() => hapticFeedback.selection()}
          >
            {emoji}
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
                      {/* {player.isPremium && <span className="text-yellow-400 ml-1">⭐</span>} // Удалено */}
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

      {/* Модал со списком всех игроков в комнате */}
      {showPlayersModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <Card className="bg-black border-gray-600 rounded-2xl max-w-md w-full max-h-[80vh] relative flex flex-col">
            {" "}
            {/* Добавлены flex flex-col */}
            <div className="flex items-center justify-between p-4 border-b border-gray-600 flex-shrink-0">
              {" "}
              {/* Добавлен flex-shrink-0 */}
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-green-400" />
                <h2 className="text-lg font-bold text-white">Игроки в комнате</h2>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-gray-400 hover:text-white"
                onClick={() => {
                  hapticFeedback.selection()
                  setShowPlayersModal(false)
                }}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {" "}
              {/* Изменено на flex-1 overflow-y-auto, удален max-h */}
              {allPlayersInRoom.length === 0 ? (
                <p className="text-gray-400 text-center py-4">В комнате пока нет игроков.</p>
              ) : (
                <div className="space-y-2">
                  {allPlayersInRoom.map((player) => (
                    <div
                      key={player.id}
                      className={`flex items-center gap-3 p-2 rounded-lg ${
                        player.isParticipant ? "bg-gray-800/50" : "bg-gray-800/30"
                      }`}
                    >
                      <img
                        src={player.avatar || "/placeholder.svg"}
                        alt="Player"
                        className="w-8 h-8 rounded-full object-cover"
                        style={{ border: player.isParticipant ? `2px solid ${player.color}` : "2px solid #4b5563" }}
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-1">
                          <span className="text-white font-medium">{player.displayName}</span>
                          {/* {player.isPremium && <span className="text-yellow-400">⭐</span>} // Удалено */}
                        </div>
                        {player.isParticipant && (
                          <div className="text-xs text-gray-400">
                            {player.tonValue.toFixed(1)} ТОН • {player.percentage.toFixed(1)}%
                          </div>
                        )}
                        {!player.isParticipant && <div className="text-xs text-gray-500">Наблюдатель</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Модал победителя */}
      {showWinnerModal && gameState.winner && (
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
              src={gameState.winner.avatar || "/placeholder.svg"}
              alt="Winner"
              className="w-16 h-16 rounded-full mx-auto mb-2 object-cover"
            />
            <div className="text-lg text-white mb-2 flex items-center justify-center gap-1">
              {gameState.winner.displayName}
              {/* {gameState.winner.isPremium && <span className="text-yellow-400">⭐</span>} // Удалено */}
            </div>
            <div className="text-sm text-gray-400 mb-4">Выиграл {gameState.totalTon.toFixed(1)} ТОН</div>
            <div className="text-xs text-gray-500">Шанс победы: {gameState.winner.percentage.toFixed(1)}%</div>
          </Card>
        </div>
      )}

      {/* Нижняя навигация */}
      <div className="fixed left-0 right-0 bg-black/80 backdrop-blur-sm border-t border-gray-700 z-50 mobile-bottom-bar">
        <div className="flex justify-around py-2">
          {[
            { icon: "💝", label: "PvP" },
            { icon: "🔔", label: "Rolls" },
            { icon: "👤", label: "Мои гифты" },
            { icon: "🏪", label: "Магазин" },
            { icon: "⚡", label: "Заработок" },
          ].map((item, index) => (
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