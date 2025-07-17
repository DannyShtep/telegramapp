import { Card } from "@/components/ui/card"
import { AlertCircle } from "lucide-react"
import { getOrCreateRoom, getPlayersInRoom, getParticipants } from "@/app/actions"
import type { Player } from "@/types/player"
import RouletteGameClient from "@/components/roulette-game-client" // Импортируем клиентский компонент

interface RoomState {
  id: string
  status: "waiting" | "single_player" | "countdown" | "spinning" | "finished"
  countdown: number // Это поле будет игнорироваться в пользу countdown_end_time на клиенте
  countdown_end_time: string | null // Новое поле для точного таймера
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

export default async function HomePage() {
  const defaultRoomId = "default-room-id"
  let initialRoomState: RoomState | null = null
  let initialPlayersInRoom: Player[] = []
  let initialParticipantsForGame: Player[] = []
  let error: string | null = null

  // Проверяем наличие Supabase URL для клиента (на сервере)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white p-4">
        <Card className="bg-gray-900 border-gray-700 p-6 text-center">
          <AlertCircle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Конфигурация не найдена</h2>
          <p className="text-gray-400">
            Supabase не настроен. Добавьте переменные окружения `NEXT_PUBLIC_SUPABASE_URL` и
            `NEXT_PUBLIC_SUPABASE_ANON_KEY` или разверните на Vercel.
          </p>
        </Card>
      </div>
    )
  }

  try {
    // Загружаем начальные данные на сервере с помощью Server Actions
    const { room, error: roomError } = await getOrCreateRoom(defaultRoomId)
    if (roomError) {
      error = roomError
    } else {
      initialRoomState = room as RoomState
    }

    if (initialRoomState) {
      const [playersResult, participantsResult] = await Promise.all([
        getPlayersInRoom(defaultRoomId),
        getParticipants(defaultRoomId),
      ])

      if (playersResult.error) {
        error = playersResult.error
      } else {
        initialPlayersInRoom = playersResult.players
      }

      if (participantsResult.error) {
        error = participantsResult.error
      } else {
        initialParticipantsForGame = participantsResult.participants
      }
    }
  } catch (e: any) {
    console.error("Error fetching initial data in Server Component:", e)
    error = e.message
  }

  // Передаем начальные данные в клиентский компонент
  return (
    <RouletteGameClient
      initialRoomState={initialRoomState}
      initialPlayersInRoom={initialPlayersInRoom}
      initialParticipantsForGame={initialParticipantsForGame}
      initialError={error}
      defaultRoomId={defaultRoomId}
    />
  )
}
