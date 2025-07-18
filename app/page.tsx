import RouletteGameClient from "@/components/roulette-game-client"
import { getOrCreateRoom, getPlayersInRoom, getParticipants } from "@/app/actions"

export const dynamic = "force-dynamic"

export default async function Home() {
  const defaultRoomId = "default-room-id" // Или другой ID комнаты, если нужно

  const { room: initialRoomState, error: roomError } = await getOrCreateRoom(defaultRoomId)
  const { players: initialPlayersInRoom, error: playersError } = await getPlayersInRoom(defaultRoomId)
  const { participants: initialParticipantsForGame, error: participantsError } = await getParticipants(defaultRoomId)

  const initialError = roomError || playersError || participantsError

  return (
    <RouletteGameClient
      initialRoomState={initialRoomState}
      initialPlayersInRoom={initialPlayersInRoom}
      initialParticipantsForGame={initialParticipantsForGame}
      initialError={initialError}
      defaultRoomId={defaultRoomId}
    />
  )
}
