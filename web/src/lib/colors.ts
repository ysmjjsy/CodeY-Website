/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
export type SemanticColor =
  | 'blue'
  | 'green'
  | 'cyan'
  | 'purple'
  | 'pink'
  | 'red'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'lime'
  | 'light-green'
  | 'teal'
  | 'light-blue'
  | 'indigo'
  | 'violet'
  | 'grey'
  | 'slate'

export const colorToBgClass: Record<SemanticColor, string> = {
  blue: 'bg-primary',
  green: 'bg-success',
  cyan: 'bg-info',
  purple: 'bg-accent-foreground',
  pink: 'bg-destructive',
  red: 'bg-destructive',
  orange: 'bg-warning',
  amber: 'bg-warning',
  yellow: 'bg-warning',
  lime: 'bg-chart-3',
  'light-green': 'bg-success/70',
  teal: 'bg-info',
  'light-blue': 'bg-info/70',
  indigo: 'bg-primary',
  violet: 'bg-accent-foreground',
  grey: 'bg-muted-foreground',
  slate: 'bg-muted-foreground',
}

export const avatarColorMap: Record<SemanticColor, string> = {
  blue: 'bg-primary/10 text-primary',
  green: 'bg-success/10 text-success-strong',
  cyan: 'bg-info/10 text-info-strong',
  purple: 'bg-accent text-accent-foreground',
  pink: 'bg-destructive/10 text-destructive',
  red: 'bg-destructive/10 text-destructive',
  orange: 'bg-warning/10 text-warning-strong',
  amber: 'bg-warning/10 text-warning-strong',
  yellow: 'bg-warning/10 text-warning-strong',
  lime: 'bg-chart-3/10 text-chart-3',
  'light-green': 'bg-success/10 text-success-strong',
  teal: 'bg-info/10 text-info-strong',
  'light-blue': 'bg-info/10 text-info-strong',
  indigo: 'bg-primary/10 text-primary',
  violet: 'bg-accent text-accent-foreground',
  grey: 'bg-muted text-muted-foreground',
  slate: 'bg-muted text-muted-foreground',
}

export function getAvatarColorClass(name: string): string {
  return avatarColorMap[stringToColor(name)]
}

export function getBgColorClass(color?: string): string {
  if (!color) return colorToBgClass.blue
  return (
    (colorToBgClass as Record<string, string>)[color] || colorToBgClass.blue
  )
}

/**
 * Announcement status types
 */
export type AnnouncementType =
  | 'default'
  | 'ongoing'
  | 'success'
  | 'warning'
  | 'error'

/**
 * Announcement status color mapping
 */
export const ANNOUNCEMENT_TYPE_COLORS: Record<AnnouncementType, string> = {
  default: 'bg-neutral',
  ongoing: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-destructive',
}

/**
 * Get announcement status color class
 */
export function getAnnouncementColorClass(type?: string): string {
  const validType = (type || 'default') as AnnouncementType
  return ANNOUNCEMENT_TYPE_COLORS[validType] || ANNOUNCEMENT_TYPE_COLORS.default
}

/**
 * Semantic colors for tags and badges
 */
const TAG_COLORS = [
  'amber',
  'blue',
  'cyan',
  'green',
  'grey',
  'indigo',
  'light-blue',
  'lime',
  'orange',
  'pink',
  'purple',
  'red',
  'teal',
  'violet',
  'yellow',
] as const

/**
 * Convert string to a stable semantic color
 * Used for model tags, group badges, user avatars, etc.
 * Same string always returns the same color
 *
 * @param str - Input string (model name, group name, username, etc.)
 * @returns Semantic color name from TAG_COLORS
 *
 * @example
 * stringToColor('gpt-4') // 'blue'
 * stringToColor('claude-3') // 'purple'
 * stringToColor('default') // 'green'
 */
export function stringToColor(str: string): SemanticColor {
  let sum = 0
  for (let i = 0; i < str.length; i++) {
    sum += str.charCodeAt(i)
  }
  const index = sum % TAG_COLORS.length
  return TAG_COLORS[index]
}
