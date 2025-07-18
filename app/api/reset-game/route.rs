import { NextResponse } from "next/server"
import { resetRoom } from "@/app/actions"

// Определите ваш секретный токен.
// В реальном приложении это должно быть в переменной окружения (например, process.env.RESET_TOKEN).
// Для примера, используем простой строковый токен.
const RESET_TOKEN = "your_secret_reset_token_123" // ЗАМЕНИТЕ ЭТО НА СВОЙ СЕКРЕТНЫЙ ТОКЕН!

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get("token")
  const roomId = searchParams.get("roomId") || "default-room-id" // Используем default-room-id или переданный

  // Проверка токена для безопасности
  if (token !== RESET_TOKEN) {
    return NextResponse.json({ error: "Unauthorized: Invalid token" }, { status: 401 })
  }

  try {
    console.log(`[API Route] Attempting to reset room: ${roomId}`)
    const { success, error } = await resetRoom(roomId)

    if (error) {
      console.error(`[API Route] Error resetting room ${roomId}:`, error)
      return NextResponse.json({ success: false, message: `Failed to reset room: ${error}` }, { status: 500 })
    }

    console.log(`[API Route] Room ${roomId} successfully reset.`)
    return NextResponse.json({ success: true, message: `Room ${roomId} reset successfully!` })
  } catch (e: any) {
    console.error(`[API Route] Caught exception during room reset for ${roomId}:`, e.message)
    return NextResponse.json({ success: false, message: `An unexpected error occurred: ${e.message}` }, { status: 500 })
  }
}
