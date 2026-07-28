/* eslint-disable react-refresh/only-export-components -- Theme tokens and their provider form one public entry point. */
import { useLayoutEffect, type CSSProperties, type ReactNode } from 'react'
import { App as AntApp, ConfigProvider, theme, type ThemeConfig } from 'antd'
import zhCN from 'antd/locale/zh_CN'

export type UiMode = 'light' | 'dark'
export type UiDensity = 'comfortable' | 'compact'
export type UiRoundness = 'rounded' | 'subtle'

export const designTokens = {
  color: {
    brand: '#0071e3',
    brandHover: '#0077ed',
    brandSoft: 'rgba(0, 113, 227, 0.08)',
    brandRing: 'rgba(0, 113, 227, 0.16)',
    success: '#52c41a',
    successText: '#389e0d',
    successSoft: '#f6ffed',
    warning: '#fa8c16',
    warningText: '#d46b08',
    warningSoft: '#fff7e6',
    danger: '#cf1322',
    dangerSoft: '#fff1f0',
    purple: '#722ed1',
    purpleSoft: '#f9f0ff',
    background: '#f5f5f7',
    surface: '#ffffff',
    subtle: '#fafafa',
    muted: '#f0f0f2',
    textPrimary: '#1d1d1f',
    textSecondary: '#86868b',
    textTertiary: '#5a5a62',
    border: 'rgba(0, 0, 0, 0.08)',
    divider: 'rgba(0, 0, 0, 0.05)',
    hover: 'rgba(0, 0, 0, 0.04)',
    onAccent: '#ffffff',
  },
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  shadow: {
    card: '0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.06)',
    cardHover: '0 6px 18px rgba(0, 0, 0, 0.09)',
  },
} as const

const darkColors = {
  brand: '#4096ff',
  brandHover: '#69b1ff',
  brandSoft: 'rgba(64, 150, 255, 0.16)',
  brandRing: 'rgba(64, 150, 255, 0.28)',
  success: '#73d13d',
  successText: '#95de64',
  successSoft: 'rgba(82, 196, 26, 0.14)',
  warning: '#ffa940',
  warningText: '#ffc069',
  warningSoft: 'rgba(250, 140, 22, 0.14)',
  danger: '#ff7875',
  dangerSoft: 'rgba(255, 77, 79, 0.14)',
  purple: '#b37feb',
  purpleSoft: 'rgba(114, 46, 209, 0.16)',
  background: '#0f1115',
  surface: '#171a21',
  subtle: '#1f232b',
  muted: '#292e38',
  textPrimary: 'rgba(255, 255, 255, 0.92)',
  textSecondary: 'rgba(255, 255, 255, 0.65)',
  textTertiary: 'rgba(255, 255, 255, 0.45)',
  border: 'rgba(255, 255, 255, 0.12)',
  divider: 'rgba(255, 255, 255, 0.08)',
  hover: 'rgba(255, 255, 255, 0.08)',
  onAccent: '#ffffff',
} as const

const radii = {
  rounded: { card: 12, control: 8, tag: 999 },
  subtle: { card: 8, control: 6, tag: 6 },
} as const

type UiPreferences = {
  mode?: UiMode
  density?: UiDensity
  roundness?: UiRoundness
}

function resolvePreferences({
  mode = 'light',
  density = 'comfortable',
  roundness = 'rounded',
}: UiPreferences = {}) {
  const light = designTokens.color
  return {
    mode,
    density,
    roundness,
    colors: mode === 'dark' ? { ...light, ...darkColors } : light,
    radius: radii[roundness],
  }
}

export function createAntTheme(preferences: UiPreferences = {}): ThemeConfig {
  const { mode, density, colors, radius } = resolvePreferences(preferences)
  return {
    algorithm: [
      mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
      ...(density === 'compact' ? [theme.compactAlgorithm] : []),
    ],
    token: {
      colorPrimary: colors.brand,
      colorInfo: colors.brand,
      colorSuccess: colors.success,
      colorWarning: colors.warning,
      colorError: colors.danger,
      colorBgLayout: colors.background,
      colorBgContainer: colors.surface,
      colorBgElevated: colors.surface,
      colorFillAlter: colors.subtle,
      colorText: colors.textPrimary,
      colorTextSecondary: colors.textSecondary,
      colorTextTertiary: colors.textTertiary,
      colorBorder: colors.border,
      colorBorderSecondary: colors.divider,
      borderRadius: radius.control,
      borderRadiusLG: radius.card,
      controlHeight: density === 'compact' ? 30 : 34,
      fontFamily: designTokens.fontFamily,
    },
    components: {
      Button: {
        fontWeight: 600,
        primaryShadow: 'none',
        defaultShadow: 'none',
        dangerShadow: 'none',
      },
      Card: {
        headerFontSize: 15,
        headerFontSizeSM: 14,
        bodyPadding: density === 'compact' ? 16 : 20,
        bodyPaddingSM: density === 'compact' ? 12 : 16,
      },
      Table: {
        headerBg: colors.subtle,
        headerColor: colors.textSecondary,
        headerSplitColor: 'transparent',
        cellPaddingBlock: density === 'compact' ? 8 : 12,
        cellPaddingInline: density === 'compact' ? 10 : 14,
      },
      Tag: {
        defaultBg: colors.subtle,
        defaultColor: colors.textTertiary,
      },
      Input: {
        activeShadow: `0 0 0 3px ${colors.brandRing}`,
      },
      Select: {
        activeOutlineColor: colors.brandRing,
      },
      Modal: {
        titleFontSize: 18,
      },
    },
  }
}

type CssVariableStyles = CSSProperties & Record<string, string | number>

export function createCssVariables(preferences: UiPreferences = {}): CssVariableStyles {
  const { density, colors, radius } = resolvePreferences(preferences)
  return {
    '--color-bg': colors.background,
    '--color-card': colors.surface,
    '--color-bg-subtle': colors.subtle,
    '--color-bg-muted': colors.muted,
    '--color-accent': colors.brand,
    '--color-accent-hover': colors.brandHover,
    '--color-accent-soft': colors.brandSoft,
    '--color-focus-ring': colors.brandRing,
    '--color-text-primary': colors.textPrimary,
    '--color-text-secondary': colors.textSecondary,
    '--color-text-tertiary': colors.textTertiary,
    '--color-border': colors.border,
    '--color-divider': colors.divider,
    '--color-hover': colors.hover,
    '--color-success': colors.success,
    '--color-success-text': colors.successText,
    '--color-success-soft': colors.successSoft,
    '--color-warning': colors.warning,
    '--color-warning-text': colors.warningText,
    '--color-warning-soft': colors.warningSoft,
    '--color-danger': colors.danger,
    '--color-danger-soft': colors.dangerSoft,
    '--color-purple': colors.purple,
    '--color-purple-soft': colors.purpleSoft,
    '--color-on-accent': colors.onAccent,
    '--radius-card': `${radius.card}px`,
    '--radius-input': `${radius.control}px`,
    '--radius-button': `${radius.control}px`,
    '--radius-tag': `${radius.tag}px`,
    '--space-page-x': density === 'compact' ? '20px' : '28px',
    '--space-page-y': density === 'compact' ? '18px' : '24px',
    '--space-section': density === 'compact' ? '16px' : '20px',
    '--table-cell-block': density === 'compact' ? '10px' : '14px',
    '--font-family': designTokens.fontFamily,
    '--shadow-card': designTokens.shadow.card,
    '--shadow-card-hover': designTokens.shadow.cardHover,
  }
}

type DesignSystemProviderProps = UiPreferences & {
  children: ReactNode
}

export function DesignSystemProvider({
  children,
  mode = 'light',
  density = 'comfortable',
  roundness = 'rounded',
}: DesignSystemProviderProps) {
  const preferences = { mode, density, roundness }
  const cssVariables = createCssVariables(preferences)

  useLayoutEffect(() => {
    const root = document.documentElement
    const rootVariables = createCssVariables({ mode, density, roundness })
    Object.entries(rootVariables).forEach(([name, value]) => root.style.setProperty(name, String(value)))
    root.dataset.theme = mode
    root.dataset.density = density
    root.dataset.roundness = roundness
  }, [density, mode, roundness])

  return (
    <ConfigProvider locale={zhCN} theme={createAntTheme(preferences)}>
      <AntApp>
        <div
          className="design-system-root"
          data-theme={mode}
          data-density={density}
          data-roundness={roundness}
          style={cssVariables}
        >
          {children}
        </div>
      </AntApp>
    </ConfigProvider>
  )
}
