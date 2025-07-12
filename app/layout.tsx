import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({ subsets: ["latin", "cyrillic"] })

export const metadata: Metadata = {
  title: "Telegram Roulette Game",
  description: "NFT Gift Roulette Game for Telegram",
  viewport: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
  other: {
    "telegram-web-app": "true",
  },
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
