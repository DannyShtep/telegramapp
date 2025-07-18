"use client"

import { useEffect, useState } from "react"

// Объявляем интерфейс для Telegram WebApp
declare global {
  interface Window {
    Telegram: {
      WebApp: {
        initData: string
        initDataUnsafe: {
          query_id?: string
          user?: {
            id: number
            first_name: string
            last_name?: string
            username?: string
            language_code?: string
            is_bot?: boolean
            is_premium?: boolean
            photo_url?: string
          }
          receiver?: {
            id: number
            first_name: string
            last_name?: string
            username?: string
            photo_url?: string
          }
          chat?: {
            id: number
            type: string
            title?: string
            username?: string
            photo_url?: string
          }
          start_param?: string
          can_send_after?: number
          auth_date: number
          hash: string
        }
        ready: () => void
        expand: () => void
        close: () => void
        MainButton: {
          text: string
          color: string
          textColor: string
          isVisible: boolean
          isActive: boolean
          setText: (text: string) => void
          show: () => void
          hide: () => void
          enable: () => void
          disable: () => void
          onClick: (callback: () => void) => void
          offClick: (callback: () => void) => void
        }
        BackButton: {
          isVisible: boolean
          show: () => void
          hide: () => void
          onClick: (callback: () => void) => void
          offClick: (callback: () => void) => void
        }
        HapticFeedback: {
          impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void
          notificationOccurred: (type: "error" | "success" | "warning") => void
          selectionChanged: () => void
        }
        showAlert: (message: string, callback?: () => void) => void
        showConfirm: (message: string, callback?: (confirmed: boolean) => void) => void
        showPopup: (params: any, callback?: (id?: string) => void) => void
        onEvent: (eventType: string, callback: (...args: any[]) => void) => void
        offEvent: (eventType: string, callback: (...args: any[]) => void) => void
      }
    }
  }
}

export interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
  is_bot?: boolean
  is_premium?: boolean
  photo_url?: string
}

export function useTelegram() {
  const [user, setUser] = useState<TelegramUser | null>(null)
  const [webApp, setWebApp] = useState<typeof window.Telegram.WebApp | null>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    if (typeof window !== "undefined" && window.Telegram && window.Telegram.WebApp) {
      const app = window.Telegram.WebApp
      app.ready()
      app.expand() // Expand the WebApp to full screen

      setWebApp(app)

      if (app.initDataUnsafe && app.initDataUnsafe.user) {
        setUser(app.initDataUnsafe.user)
      }
      setIsReady(true)
    } else {
      // Fallback for development outside Telegram
      console.warn("Telegram WebApp is not available. Using mock data.")
      setWebApp(null)
      setUser({
        id: 123456789,
        first_name: "Dev",
        username: "dev_user",
        photo_url: "https://via.placeholder.com/150/0000FF/FFFFFF?text=DEV",
      })
      setIsReady(true)
    }
  }, [])

  const getUserPhotoUrl = (telegramUser: TelegramUser): string | null => {
    // Telegram WebApp initDataUnsafe.user.photo_url is often not available or is a small thumbnail.
    // For a real app, you'd typically fetch a larger photo via Telegram Bot API or a proxy.
    // For now, we'll use the provided one or a placeholder.
    return telegramUser.photo_url || null
  }

  const getUserDisplayName = (telegramUser: TelegramUser): string => {
    if (telegramUser.username) {
      return `@${telegramUser.username}`
    }
    if (telegramUser.first_name && telegramUser.last_name) {
      return `${telegramUser.first_name} ${telegramUser.last_name}`
    }
    return telegramUser.first_name || `User ${telegramUser.id}`
  }

  return {
    webApp,
    user,
    isReady,
    // Улучшенная логика fallback для HapticFeedback
    hapticFeedback: {
      impactOccurred: webApp?.HapticFeedback?.impactOccurred || ((style) => console.log(`Haptic: ${style} impact`)),
      notificationOccurred:
        webApp?.HapticFeedback?.notificationOccurred || ((type) => console.log(`Haptic: ${type} notification`)),
      selectionChanged: webApp?.HapticFeedback?.selectionChanged || (() => console.log("Haptic: selection changed")),
    },
    showAlert:
      webApp?.showAlert ||
      ((message, cb) => {
        alert(message)
        cb?.()
      }),
    showConfirm:
      webApp?.showConfirm ||
      ((message, cb) => {
        const confirmed = confirm(message)
        cb?.(confirmed)
      }),
    showPopup:
      webApp?.showPopup ||
      ((params, cb) => {
        console.log("Mock showPopup:", params)
        cb?.("mock_button_id")
      }),
    getUserPhotoUrl,
    getUserDisplayName,
  }
}
