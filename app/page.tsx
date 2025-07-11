"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Plus, Loader2, X } from "lucide-react"

interface Player {
  id: string
  username: string
  avatar: string
  gifts: number
  tonValue: number
  color: string
  percentage: number
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
  const [isLoading, setIsLoading] = useState(true)
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
  // Состояние для суммы, отображаемой на кнопке "Добавить ТОН"
  const [displayedTonAmount, setDisplayedTonAmount] = useState(Math.floor(Math.random() * 20 + 5))

  const playerColors = ["#ef4444", "#22c55e", "#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899"]

  // Загрузочный экран
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false)
    }, 4000)

    return () => clearTimeout(timer)
  }, [])

  const addPlayer = useCallback(
    (isGift = true, tonAmountToAdd?: number) => {
      if (gameState.status === "countdown" && gameState.countdown <= 3) return
      if (gameState.status === "spinning" || gameState.status === "finished") return

      const newPlayer: Player = {
        id: `player_${Date.now()}`,
        username: `@Player${gameState.players.length + 1}`,
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${Date.now()}`,
        gifts: isGift ? 1 : 0,
        // Если это кнопка "Добавить ТОН" (isGift === false), используем переданное tonAmountToAdd.
        // Иначе (для "Добавить гифт"), генерируем случайное значение.
        tonValue: isGift ? Math.random() * 20 + 5 : tonAmountToAdd!,
        color: playerColors[gameState.players.length % playerColors.length],
        percentage: 0,
      }

      setGameState((prev) => {
        const updatedPlayers = [...prev.players, newPlayer]
        const newTotalTon = updatedPlayers.reduce((sum, p) => sum + p.tonValue, 0)
        // totalGifts теперь считает общее количество игроков
        const newTotalGifts = updatedPlayers.length

        // Пересчитываем проценты
        const playersWithPercentages = updatedPlayers.map((player) => ({
          ...player,
          percentage: (player.tonValue / newTotalTon) * 100,
        }))

        const newStatus =
          updatedPlayers.length === 1 ? "single_player" : updatedPlayers.length >= 2 ? "countdown" : "waiting"

        return {
          ...prev,
          players: playersWithPercentages,
          totalGifts: newTotalGifts,
          totalTon: newTotalTon,
          status: newStatus,
        }
      })
    },
    [gameState.status, gameState.countdown, gameState.players.length],
  )

  // Таймер обратного отсчета
  useEffect(() => {
    let interval: NodeJS.Timeout

    if (gameState.status === "countdown" && gameState.countdown > 0) {
      interval = setInterval(() => {
        setGameState((prev) => {
          const newCountdown = prev.countdown - 1

          if (newCountdown === 0) {
            // Запускаем рулетку
            const randomRotation = 5400 + Math.random() * 1440 // 15 оборотов + случайный угол
            setRotation((prev) => prev + randomRotation)

            // Определяем победителя через 15 секунд
            setTimeout(() => {
              const randomValue = Math.random() * prev.totalTon
              let currentSum = 0
              const winner =
                prev.players.find((player) => {
                  currentSum += player.tonValue
                  return randomValue <= currentSum
                }) || prev.players[0]

              setGameState((current) => ({
                ...current,
                status: "finished",
                winner,
              }))
              setShowWinnerModal(true)

              // Автоматически закрываем модал через 6 секунд
              setTimeout(() => {
                setShowWinnerModal(false)
                // Сброс игры
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
                  setDisplayedTonAmount(Math.floor(Math.random() * 20 + 5)) // Обновляем сумму для кнопки при сбросе
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
  }, [gameState.status, gameState.countdown])

  const getWheelSegments = () => {
    if (gameState.players.length === 0) return []

    let currentAngle = 0
    return gameState.players.map((player) => {
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

  // Загрузочный экран
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 flex flex-col items-center justify-center relative overflow-hidden">
        {/* Абстрактный фон */}
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-10 left-10 w-32 h-32 bg-green-500/10 rounded-full blur-xl"></div>
          <div className="absolute top-1/3 right-20 w-48 h-48 bg-green-400/5 rounded-full blur-2xl"></div>
          <div className="absolute bottom-20 left-1/4 w-40 h-40 bg-green-600/10 rounded-full blur-xl"></div>
          <div className="absolute bottom-1/3 right-1/3 w-24 h-24 bg-green-500/15 rounded-full blur-lg"></div>
        </div>

        {/* Логотип */}
        <div className="relative z-10 mb-8">
          <img src="/grinch-logo.jpeg" alt="The Grinch Roulette" className="w-80 h-auto max-w-sm" />
        </div>

        {/* Анимированная иконка загрузки */}
        <div className="relative z-10">
          <Loader2 className="w-8 h-8 text-green-400 animate-spin" />
        </div>
      </div>
    )
  }

  // Определяем класс размера шрифта для кнопки "Добавить ТОН"
  // Используем text-xs для двузначных чисел, чтобы гарантировать, что они поместятся
  const tonButtonFontSizeClass = displayedTonAmount >= 10 ? "text-xs" : "text-base"

  // Функция для склонения слова "подарок"
  const formatGiftsText = (count: number) => {
    if (count === 0) return "0 подарков"
    if (count === 1) return "1 подарок"
    if (count >= 2 && count <= 4) return `${count} подарка`
    return `${count} подарков`
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-black text-white relative overflow-hidden">
      {/* Общий банк */}
      <div className="flex items-center justify-center mb-4 pt-6 relative z-10">
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
        {/* Указатель - теперь позиционируется относительно контейнера колеса */}
        <div className="absolute top-[-15px] left-1/2 -translate-x-1/2 z-30 transform rotate-180">
          <div className="w-0 h-0 border-l-[10px] border-r-[10px] border-b-[15px] border-l-transparent border-r-transparent border-b-green-500"></div>
        </div>

        {/* Колесо */}
        <div
          className="w-80 h-80 min-w-80 min-h-80 max-w-80 max-h-80 rounded-full relative overflow-hidden shadow-2xl shadow-gray-900/50"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: gameState.status === "spinning" ? "transform 15s cubic-bezier(0.25, 0.1, 0.25, 1)" : "none",
          }}
        >
          {gameState.status === "waiting" ? (
            // Серое колесо для ожидания
            <div className="w-full h-full bg-gray-600 relative">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 bg-black rounded-full flex items-center justify-center border-0">
                <span className="text-gray-300 text-sm font-medium">Ожидание</span>
              </div>
            </div>
          ) : gameState.status === "single_player" ? (
            // Одноцветное колесо для одного игрока
            <div className="w-full h-full relative" style={{ backgroundColor: gameState.players[0]?.color }}>
              {/* Аватар игрока */}
              <div className="absolute top-16 left-16 w-8 h-8 rounded-full overflow-hidden border-2 border-white">
                <div
                  className="w-full h-full bg-white flex items-center justify-center text-xs font-bold"
                  style={{ color: gameState.players[0]?.color }}
                >
                  {gameState.players[0]?.username.charAt(1).toUpperCase()}
                </div>
              </div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 bg-black rounded-full flex items-center justify-center border-0">
                <span className="text-gray-300 text-sm font-medium">Ожидание</span>
              </div>
            </div>
          ) : (
            // Многосекторное колесо
            <>
              <svg className="w-full h-full" viewBox="0 0 200 200">
                {segments.map((segment, index) => {
                  const startAngleRad = (segment.startAngle * Math.PI) / 180
                  const endAngleRad = (segment.endAngle * Math.PI) / 180
                  const largeArcFlag = segment.angle > 180 ? 1 : 0

                  // Увеличен радиус до 100
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

                  // Позиция для аватара (немного отодвинута от центра)
                  const midAngle = (segment.startAngle + segment.endAngle) / 2
                  const midAngleRad = (midAngle * Math.PI) / 180
                  const avatarX = 100 + 70 * Math.cos(midAngleRad) // Увеличено с 60 до 70
                  const avatarY = 100 + 70 * Math.sin(midAngleRad) // Увеличено с 60 до 70

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
                      <text
                        x={avatarX}
                        y={avatarY + 2}
                        textAnchor="middle"
                        fontSize="8"
                        fontWeight="bold"
                        fill={segment.player.color}
                      >
                        {segment.player.username.charAt(1).toUpperCase()}
                      </text>
                    </g>
                  )
                })}
              </svg>

              {/* Центральный круг с таймером */}
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
            addPlayer(false, displayedTonAmount) // Передаем отображаемую сумму
            setDisplayedTonAmount(Math.floor(Math.random() * 20 + 5)) // Генерируем новую сумму для следующего отображения
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
          >
            {emoji}
          </Button>
        ))}
      </div>

      {/* Список игроков */}
      <div className="px-4 mb-20 relative z-10">
        {gameState.players.length === 0 ? (
          <Card className="bg-black/60 border-gray-600 p-4 backdrop-blur-sm text-center mb-4">
            {/* Пустое место */}
          </Card>
        ) : (
          gameState.players.map((player, index) => (
            <div key={player.id} className="mb-3">
              <Card className="bg-black/60 border-gray-600 p-4 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
                      style={{ backgroundColor: player.color }}
                    >
                      {player.username.charAt(1).toUpperCase()}
                    </div>
                    <span className="text-white font-medium">{player.username}</span>
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
            <div className="text-lg text-white mb-2">{gameState.winner.username}</div>
            <div className="text-sm text-gray-400 mb-4">Выиграл {gameState.totalTon.toFixed(1)} ТОН</div>
            <div className="text-xs text-gray-500">Шанс победы: {gameState.winner.percentage.toFixed(1)}%</div>
          </Card>
        </div>
      )}

      {/* Нижняя навигация */}
      <div className="fixed bottom-0 left-0 right-0 bg-black/80 backdrop-blur-sm border-t border-gray-700 z-50">
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
