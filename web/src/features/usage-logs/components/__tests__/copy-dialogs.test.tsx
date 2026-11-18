import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'

import { FailReasonDialog } from '../dialogs/fail-reason-dialog'
import { PromptDialog } from '../dialogs/prompt-dialog'

const getAnimationsDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'getAnimations'
)

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
})

afterAll(() => {
  if (getAnimationsDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      'getAnimations',
      getAnimationsDescriptor
    )
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations')
  }
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
})

test('copies the failure reason and reports success', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
  render(
    <FailReasonDialog
      failReason='Upstream unavailable'
      open
      onOpenChange={() => undefined}
    />
  )

  fireEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }))

  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith('Upstream unavailable')
  )
  expect(
    await screen.findByRole('button', { name: 'Copied' })
  ).toBeInTheDocument()
})

test('copies each prompt in its original language', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
  render(
    <PromptDialog
      prompt='原始提示词'
      promptEn='Original prompt'
      open
      onOpenChange={() => undefined}
    />
  )

  const buttons = screen.getAllByRole('button', { name: 'Copy to clipboard' })
  fireEvent.click(buttons[0])
  await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('原始提示词'))
  fireEvent.click(buttons[1])
  await waitFor(() =>
    expect(writeText).toHaveBeenLastCalledWith('Original prompt')
  )
})
