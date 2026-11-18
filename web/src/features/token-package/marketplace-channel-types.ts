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

// Standard protocol types a seller may publish. Task plugins, video and image
// generators, and advanced custom channels are excluded on purpose.
export const MARKETPLACE_CHANNEL_TYPES = [
  1, 3, 8, 14, 17, 20, 23, 24, 25, 26, 27, 33, 34, 35, 39, 40, 41, 42, 43, 45,
  46, 47, 48, 53, 59, 60,
] as const
