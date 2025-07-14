"use client"

import { useEffect, useState } from "react"
import type { TelegramWebApp, TelegramUser } from "../types/telegram"

export function useTelegram() {
  const [webApp, setWebApp] = useState<TelegramWebApp | null>(null)
  const [user, setUser] = useState<TelegramUser | null>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    // Проверяем, существует ли объект Telegram WebApp
    if (typeof window !== "undefined" && window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp
      setWebApp(tg)

      // Инициализируем WebApp
      tg.ready()

      // Расширяем на весь экран
      tg.expand()

      // Устанавливаем цвета темы
      tg.headerColor = "#1f2937"
      tg.backgroundColor = "#111827"

      // Отключаем вертикальные свайпы
      tg.disableVerticalSwipes(true)

      // Получаем данные пользователя
      if (tg.initDataUnsafe?.user) {
        setUser(tg.initDataUnsafe.user)
        // !!! ВАЖНО: Логируем данные пользователя для отладки !!!
        console.log("[TG WebApp] User data received:", JSON.stringify(tg.initDataUnsafe.user))
      } else {
        // В этом случае данные пользователя отсутствуют, но WebApp обнаружен.
        console.log("[TG WebApp] User data missing in initDataUnsafe.")
      }

      setIsReady(true)
    } else {
      // Fallback для разработки/не-Telegram окружений (браузер V0 Preview)
      const mockUser: TelegramUser = {
        id: Math.floor(Math.random() * 1000000),
        first_name: "Test",
        last_name: "User",
        username: "testuser",
        language_code: "ru",
      }
      setUser(mockUser)
      setIsReady(true)
      // В браузере выводим в консоль, чтобы не блокировать UI
      console.log(`[MOCK DATA FALLBACK] User Data: ${JSON.stringify(mockUser)}`)
    }
  }, []) // Пустой массив зависимостей, чтобы эффект запускался только один раз при монтировании

  const hapticFeedback = {
    impact: (style: "light" | "medium" | "heavy" | "rigid" | "soft" = "medium") => {
      webApp?.HapticFeedback.impactOccurred(style)
    },
    notification: (type: "error" | "success" | "warning") => {
      webApp?.HapticFeedback.notificationOccurred(type)
    },
    selection: () => {
      webApp?.HapticFeedback.selectionChanged()
    },
  }

  const showAlert = (message: string) => {
    if (webApp) {
      webApp.showAlert(message)
    } else {
      // Fallback на console.log для браузера, чтобы не блокировать UI
      console.log(`[Browser Console Alert] ${message}`)
    }
  }

  const showConfirm = (message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (webApp) {
        webApp.showConfirm(message, resolve)
      } else {
        resolve(confirm(message))
      }
    })
  }

  const close = () => {
    webApp?.close()
  }

  const getUserPhotoUrl = (user: TelegramUser): string => {
    // Если есть photo_url из Telegram, используем его
    if (user.photo_url) {
      return user.photo_url
    }
    // В противном случае (нет photo_url от Telegram или не в WebApp), используем внутренний плейсхолдер
    return `/placeholder.svg?height=64&width=64`
  }

  const getUserDisplayName = (user: TelegramUser): string => {
    if (user.username) {
      return `@${user.username}`
    }
    const fullName = `${user.first_name || ""}${user.last_name ? " " + user.last_name : ""}`.trim()
    // Если fullName пустой, используем "User [ID]" или "Unknown User" как последний запасной вариант.
    return fullName || (user.id ? `User ${user.id}` : "Unknown User")
  }

  return {
    webApp,
    user,
    isReady,
    hapticFeedback,
    showAlert,
    showConfirm,
    close,
    getUserPhotoUrl,
    getUserDisplayName,
  }
}