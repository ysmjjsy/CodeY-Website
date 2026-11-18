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
/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useMemo, useState } from 'react'

import type { UserChannel } from '@/features/token-package/types'

type MyChannelsDialog = 'create' | 'edit' | null

type MyChannelsContextValue = {
  open: MyChannelsDialog
  setOpen: (open: MyChannelsDialog) => void
  currentRow: UserChannel | null
  setCurrentRow: (row: UserChannel | null) => void
  testRow: UserChannel | null
  setTestRow: (row: UserChannel | null) => void
  deleteRow: UserChannel | null
  setDeleteRow: (row: UserChannel | null) => void
  batchMode: boolean
  setBatchMode: (enabled: boolean) => void
}

const MyChannelsContext = createContext<MyChannelsContextValue | undefined>(
  undefined
)

export function MyChannelsProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [open, setOpen] = useState<MyChannelsDialog>(null)
  const [currentRow, setCurrentRow] = useState<UserChannel | null>(null)
  const [testRow, setTestRow] = useState<UserChannel | null>(null)
  const [deleteRow, setDeleteRow] = useState<UserChannel | null>(null)
  const [batchMode, setBatchMode] = useState(false)

  const value = useMemo(
    () => ({
      open,
      setOpen,
      currentRow,
      setCurrentRow,
      testRow,
      setTestRow,
      deleteRow,
      setDeleteRow,
      batchMode,
      setBatchMode,
    }),
    [open, currentRow, testRow, deleteRow, batchMode]
  )

  return (
    <MyChannelsContext.Provider value={value}>
      {children}
    </MyChannelsContext.Provider>
  )
}

export function useMyChannels() {
  const context = useContext(MyChannelsContext)
  if (!context) {
    throw new Error('useMyChannels must be used within MyChannelsProvider')
  }
  return context
}
