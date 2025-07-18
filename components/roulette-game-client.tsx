"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Plus, X, Eye, Users, AlertCircle } from 'lucide-react' // Удалена RotateCcw
import { useTelegram } from "../hooks/useTelegram"
import type { TelegramUser } from "../types/telegram"
import { createClientComponentClient } from "@/lib/supabase"
import {
addPlayerToRoom,
getPlayersInRoom,
ensureUserOnline,
determineWinnerAndSpin,
resetRoom,
getParticipants,
} from "@/app/actions"
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
