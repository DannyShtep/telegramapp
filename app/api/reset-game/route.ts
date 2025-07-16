import { NextResponse } from "next/server"
import { resetRoom } from "@/app/actions"

export async function GET() {
  const roomId = "default-room-id" // Убедитесь, что это тот же ID комнаты, что и в app/page.tsx
  console.log(`[API Route] Attempting to reset room: ${roomId}`)
  const { success, error } = await resetRoom(roomId)

  if (error) {
    console.error(`[API Route] Failed to reset room ${roomId}:`, error)
    return NextResponse.json({ success: false, message: `Failed to reset room: ${error}` }, { status: 500 })
  }

  console.log(`[API Route] Room ${roomId} reset successfully.`)
  return NextResponse.json({ success: true, message: `Room ${roomId} reset successfully.` })
}
