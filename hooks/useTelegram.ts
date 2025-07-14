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

      // Всегда показываем alert, чтобы подтвердить, что WebApp обнаружен
      tg.showAlert(`[TG WebApp Detected]`)

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
        // Этот alert покажет данные пользователя, если они есть, в нативном приложении
        tg.showAlert(`[TG User Data from WebApp] ${JSON.stringify(tg.initDataUnsafe.user)}`)
      } else {
        // Этот alert покажет, если WebApp обнаружен, но данные пользователя отсутствуют
        tg.showAlert("[TG WebApp] User data missing in initDataUnsafe.")
      }

      setIsReady(true)
    } else {
      // Fallback для разработки/не-Telegram окружений
      const mockUser: TelegramUser = {
        id: Math.floor(Math.random() * 1000000),
        first_name: "Test",
        last_name: "User",
        username: "testuser",
        photo_url: "https://api.dicebear.com/7.x/avataaars/svg?seed=testuser",
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
    if (user.photo_url) {
      return user.photo_url
    }
    // Fallback к Dicebear с использованием user ID
    return `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}`
  }

  const getUserDisplayName = (user: TelegramUser): string => {
    if (user.username) {
      return `@${user.username}`
    }
    return `${user.first_name}${user.last_name ? " " + user.last_name : ""}`
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
