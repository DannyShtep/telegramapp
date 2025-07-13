import type React from "react"
import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({ subsets: ["latin", "cyrillic"] })

export const metadata: Metadata = {
  title: "Telegram Roulette Game",
  description: "NFT Gift Roulette Game for Telegram",
  other: {
    "telegram-web-app": "true",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru">
      <head>
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
      </head>
      <body className={`${inter.className} overflow-x-hidden`} style={{ userSelect: "none", WebkitUserSelect: "none" }}>
        {children}
      </body>
    </html>
  )
}
