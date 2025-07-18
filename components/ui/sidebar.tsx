"use client"

import type * as React from "react"
import { cn } from "@/lib/utils"
import { ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"

interface SidebarProps extends React.ComponentProps<typeof ResizablePanelGroup> {
  children: React.ReactNode
  className?: string
}

const Sidebar = ({ children, className, ...props }: SidebarProps) => {
  return (
    <ResizablePanelGroup direction="horizontal" className={cn("min-h-[calc(100vh-64px)] w-full", className)} {...props}>
      {children}
    </ResizablePanelGroup>
  )
}

interface SidebarPanelProps extends React.ComponentProps<typeof ResizablePanel> {
  children: React.ReactNode
  className?: string
}

const SidebarPanel = ({ children, className, ...props }: SidebarPanelProps) => {
  return (
    <ResizablePanel className={cn("flex flex-col", className)} {...props}>
      {children}
    </ResizablePanel>
  )
}

interface SidebarContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  className?: string
}

const SidebarContent = ({ children, className, ...props }: SidebarContentProps) => {
  return (
    <div className={cn("flex-1 overflow-auto p-4", className)} {...props}>
      {children}
    </div>
  )
}

interface SidebarHandleProps extends React.ComponentProps<typeof ResizablePanel> {
  className?: string
}

const SidebarHandle = ({ className, ...props }: SidebarHandleProps) => {
  return (
    <ResizablePanel className={cn("flex items-center justify-center w-2 bg-border", className)} {...props}>
      <div className="h-10 w-1 rounded-full bg-gray-400" />
    </ResizablePanel>
  )
}

export { Sidebar, SidebarPanel, SidebarContent, SidebarHandle }
