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

// Input routes into the exchange core. `d` is the signal path the active
// model lights up and the packet travels.
export interface TmRoute {
  key: string
  d: string
}

export const TM_INPUT_ROUTES: TmRoute[] = [
  { key: 'route-claude', d: 'M85 75 266 129 316 142' },
  { key: 'route-openai', d: 'M55 182 247 162 314 151' },
  { key: 'route-deepseek', d: 'M98 284 275 196 324 165' },
]
