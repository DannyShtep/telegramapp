"use client"

import * as React from "react"
import {
  CartesianGrid,
  Line,
  LineChart,
  Bar,
  BarChart,
  PieChart,
  Pie,
  RadialBarChart,
  RadialBar,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
} from "recharts"
// Эти компоненты определены ниже в этом же файле и не требуют импорта из него самого.
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

// Helper to generate a unique ID
const generateId = () => Math.random().toString(36).substring(2, 15)

// Define chart types and their components
const chartComponents = {
  LineChart,
  BarChart,
  PieChart,
  RadialBarChart,
  AreaChart,
  ScatterChart,
}

const seriesComponents = {
  Line,
  Bar,
  Pie,
  RadialBar,
  Area,
  Scatter,
}

type ChartType = keyof typeof chartComponents
type SeriesType = keyof typeof seriesComponents

interface ChartConfig {
  [key: string]: {
    label: string
    color: string
    type: SeriesType
  }
}

// Определения ChartContainer, ChartTooltip, ChartTooltipContent
// Эти компоненты являются частью shadcn/ui и определены здесь.
// Они не должны импортироваться из этого же файла.

interface ChartContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  config: any
  aspect?: number
}

const ChartContainer = React.forwardRef<HTMLDivElement, ChartContainerProps>(
  ({ className, children, config, aspect, ...props }, ref) => (
    <div ref={ref} className={cn("w-full h-full", className)} style={{ aspectRatio: aspect }} {...props}>
      {children}
    </div>
  ),
)
ChartContainer.displayName = "ChartContainer"

interface ChartTooltipProps extends React.HTMLAttributes<HTMLDivElement> {
  cursor?: boolean
  content?: React.ComponentType<any>
}

const ChartTooltip = React.forwardRef<HTMLDivElement, ChartTooltipProps>(
  ({ className, children, cursor, content: Content, ...props }, ref) => (
    <div ref={ref} className={cn("relative", className)} {...props}>
      {children}
      {cursor && <div className="absolute inset-0 bg-gray-200 opacity-20" />}
      {Content && <Content />}
    </div>
  ),
)
ChartTooltip.displayName = "ChartTooltip"

interface ChartTooltipContentProps extends React.HTMLAttributes<HTMLDivElement> {
  hideLabel?: boolean
}

const ChartTooltipContent = React.forwardRef<HTMLDivElement, ChartTooltipContentProps>(
  ({ className, children, hideLabel, ...props }, ref) => (
    <div ref={ref} className={cn("bg-white p-2 rounded shadow-md text-sm", className)} {...props}>
      {children}
    </div>
  ),
)
ChartTooltipContent.displayName = "ChartTooltipContent"

interface ChartProps extends React.ComponentProps<typeof ChartContainer> {
  data: Record<string, any>[]
  chartConfig: ChartConfig
  chartType?: ChartType
  seriesType?: SeriesType
  showGrid?: boolean
  showTooltip?: boolean
  showXAxis?: boolean
  showYAxis?: boolean
  showLegend?: boolean
  aspectRatio?: number
  syncId?: string
  enableZoom?: boolean
  enableBrush?: boolean
  brushStart?: number
  brushEnd?: number
  onBrushChange?: (startIndex: number, endIndex: number) => void
  customTooltip?: React.ComponentType<any>
  customDot?: (...args: any[]) => any
  customLabel?: (...args: any[]) => any
  className?: string
}

const Chart = React.forwardRef<HTMLDivElement, ChartProps>(
  (
    {
      data,
      chartConfig,
      chartType = "LineChart",
      seriesType = "Line",
      showGrid = true,
      showTooltip = true,
      showXAxis = true,
      showYAxis = true,
      showLegend = false,
      aspectRatio = 16 / 9,
      syncId,
      enableZoom = false,
      enableBrush = false,
      brushStart,
      brushEnd,
      onBrushChange,
      customTooltip,
      customDot,
      customLabel,
      className,
      ...props
    },
    ref,
  ) => {
    const chartId = React.useMemo(generateId, [])

    const ChartComponent = chartComponents[chartType]
    const SeriesComponent = seriesComponents[seriesType]

    const defaultTooltipContent = (props: any) => (
      <ChartTooltipContent
        hideLabel={chartType === "PieChart" || chartType === "RadialBarChart"}
        className="[&.recharts-tooltip-wrapper]:!bg-background [&.recharts-tooltip-wrapper]:!border-border [&.recharts-tooltip-wrapper]:!text-foreground"
        {...props}
      />
    )

    const renderSeries = () => {
      return Object.entries(chartConfig).map(([key, { label, color, type, ...rest }]) => {
        if (type === seriesType) {
          return (
            <SeriesComponent
              key={key}
              dataKey={key}
              name={label}
              stroke={`hsl(${color})`}
              fill={`hsl(${color})`}
              dot={customDot}
              label={customLabel}
              {...rest}
            />
          )
        }
        return null
      })
    }

    if (!ChartComponent || !SeriesComponent) {
      console.error(`Unsupported chartType: ${chartType} or seriesType: ${seriesType}`)
      return null
    }

    return (
      <ChartContainer ref={ref} config={chartConfig} className={cn("min-h-[200px] w-full", className)} {...props}>
        <ChartComponent
          accessibilityLayer
          data={data}
          margin={{ left: -10, right: 10 }}
          syncId={syncId}
          aspect={aspectRatio}
        >
          {showGrid && <CartesianGrid vertical={false} />}
          {showXAxis && (
            <XAxis
              dataKey={Object.keys(data[0] || {})[0]}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value) => value.slice(0, 3)}
            />
          )}
          {showYAxis && <YAxis tickLine={false} axisLine={false} tickMargin={8} />}
          {showTooltip && <ChartTooltip cursor={false} content={customTooltip || defaultTooltipContent} />}
          {renderSeries()}
          {showLegend && (
            <div className="flex justify-center gap-4 pt-2">
              {Object.entries(chartConfig).map(([key, { label, color }]) => (
                <div key={key} className="flex items-center gap-1">
                  <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: `hsl(${color})` }} />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
          )}
        </ChartComponent>
      </ChartContainer>
    )
  },
)
Chart.displayName = "Chart"

interface ChartToggleProps extends React.ComponentProps<typeof Card> {
  chartType: ChartType
  onChartTypeChange: (type: ChartType) => void
  showDataToggle?: boolean
  onShowDataToggleChange?: (checked: boolean) => void
  dataToggleChecked?: boolean
  availableChartTypes?: ChartType[]
}

const ChartToggle = React.forwardRef<HTMLDivElement, ChartToggleProps>(
  (
    {
      chartType,
      onChartTypeChange,
      showDataToggle = false,
      onShowDataToggleChange,
      dataToggleChecked,
      availableChartTypes = ["LineChart", "BarChart", "AreaChart"],
      className,
      ...props
    },
    ref,
  ) => {
    return (
      <Card ref={ref} className={cn("p-4", className)} {...props}>
        <div className="flex items-center justify-between">
          <Select value={chartType} onValueChange={(value) => onChartTypeChange(value as ChartType)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select Chart Type" />
            </SelectTrigger>
            <SelectContent>
              {availableChartTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {type.replace("Chart", " Chart")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {showDataToggle && onShowDataToggleChange && (
            <div className="flex items-center space-x-2">
              <Switch id="show-data" checked={dataToggleChecked} onCheckedChange={onShowDataToggleChange} />
              <Label htmlFor="show-data">Show Data</Label>
            </div>
          )}
        </div>
      </Card>
    )
  },
)
ChartToggle.displayName = "ChartToggle"

export { Chart, ChartToggle }
