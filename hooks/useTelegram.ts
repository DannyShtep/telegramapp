"use client"

import { useEffect, useState, useCallback } from "react"
import type { TelegramUser, TelegramWebApp } from "../types/telegram"

interface UseTelegramResult {
  webApp: TelegramWebApp | null
  user: TelegramUser | null
  isReady: boolean
  hapticFeedback: TelegramWebApp["HapticFeedback"]
  showAlert: TelegramWebApp["showAlert"]
  showConfirm: TelegramWebApp["showConfirm"]
  showPopup: TelegramWebApp["showPopup"]
  expand: TelegramWebApp["expand"]
  close: TelegramWebApp["close"]
  getUserPhotoUrl: (user: TelegramUser) => string | null
  getUserDisplayName: (user: TelegramUser) => string
}

export function useTelegram(): UseTelegramResult {
  const [webApp, setWebApp] = useState<TelegramWebApp | null>(null)
  const [user, setUser] = useState<TelegramUser | null>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    if (typeof window !== "undefined" && window.Telegram && window.Telegram.WebApp) {
      const app = window.Telegram.WebApp
      app.ready()
      app.expand() // Expand the Web App to full screen

      setWebApp(app)
      setUser(app.initDataUnsafe.user || null)
      setIsReady(true)

      // Log initial theme and viewport info
      console.log("Telegram WebApp initialized:", {
        platform: app.platform,
        colorScheme: app.colorScheme,
        viewportHeight: app.viewportHeight,
        viewportStableHeight: app.viewportStableHeight,
        isExpanded: app.isExpanded,
        initDataUnsafe: app.initDataUnsafe,
      })

      // Set header and background colors based on theme
      app.setHeaderColor("secondary_bg_color")
      app.setBackgroundColor("bg_color")

      // Event listeners for theme and viewport changes
      const handleThemeChange = () => {
        console.log("Theme changed:", app.themeParams)
        app.setHeaderColor("secondary_bg_color")
        app.setBackgroundColor("bg_color")
      }

      const handleViewportChanged = () => {
        console.log("Viewport changed:", {
          isExpanded: app.isExpanded,
          viewportHeight: app.viewportHeight,
          viewportStableHeight: app.viewportStableHeight,
        })
        if (!app.isExpanded) {
          app.expand() // Re-expand if it somehow collapses
        }
      }

      app.onEvent("themeChanged", handleThemeChange)
      app.onEvent("viewportChanged", handleViewportChanged)

      return () => {
        app.offEvent("themeChanged", handleThemeChange)
        app.offEvent("viewportChanged", handleViewportChanged)
      }
    } else {
      console.warn("Telegram WebApp script not found or not ready.")
      // Fallback for development outside Telegram environment
      setWebApp(null)
      setUser({
        id: 123456789,
        first_name: "Test",
        last_name: "User",
        username: "testuser",
        language_code: "en",
        is_bot: false,
        is_premium: true,
        photo_url: "https://via.placeholder.com/150/0000FF/FFFFFF?text=TU", // Placeholder image
      })
      setIsReady(true)
    }
  }, [])

  const hapticFeedback = webApp?.HapticFeedback || {
    impactOccurred: (style) => console.log(`Haptic: ${style} impact`),
    notificationOccurred: (type) => console.log(`Haptic: ${type} notification`),
    selectionChanged: () => console.log("Haptic: selection changed"),
  }

  const showAlert =
    webApp?.showAlert ||
    ((message, callback) => {
      alert(message)
      callback?.()
    })

  const showConfirm =
    webApp?.showConfirm ||
    ((message, callback) => {
      const result = confirm(message)
      callback?.(result)
    })

  const showPopup =
    webApp?.showPopup ||
    ((params, callback) => {
      console.log("Showing popup:", params)
      alert(params.message)
      callback?.("ok") // Simulate 'ok' button click
    })

  const expand = webApp?.expand || (() => console.log("WebApp expand called (mock)"))
  const close = webApp?.close || (() => console.log("WebApp close called (mock)"))

  const getUserPhotoUrl = useCallback((telegramUser: TelegramUser): string | null => {
    // Telegram WebApp does not directly provide a high-res user photo URL in initDataUnsafe.user
    // The photo_url in initDataUnsafe.user is often a low-res placeholder or not present.
    // For actual user photos, you'd typically need to use the Bot API's getUserProfilePhotos method
    // on your backend, which is outside the scope of the WebApp itself.
    // For now, we'll use the provided photo_url if it exists, otherwise a generic placeholder.
    return telegramUser.photo_url || null
  }, [])

  const getUserDisplayName = useCallback((telegramUser: TelegramUser): string => {
    if (telegramUser.username) {
      return `@${telegramUser.username}`
    }
    if (telegramUser.first_name && telegramUser.last_name) {
      return `${telegramUser.first_name} ${telegramUser.last_name}`
    }
    return telegramUser.first_name || `User ${telegramUser.id}`
  }, [])

  return {
    webApp,
    user,
    isReady,
    hapticFeedback,
    showAlert,
    showConfirm,
    showPopup,
    expand,
    close,
    getUserPhotoUrl,
    getUserDisplayName,
  }
}
