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
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { testMyChannel } from '@/features/token-package/api'
import { handleServerError } from '@/lib/handle-server-error'
import {
  createServerError,
  translateServerText,
} from '@/lib/server-error-message'

import { MY_CHANNELS_QUERY_KEY, parseModelList } from '../lib'
import { useMyChannels } from './my-channels-provider'

const ENDPOINT_OPTIONS = [
  { value: 'auto', label: 'Auto detect (default)' },
  { value: 'openai', label: 'OpenAI', path: '/v1/chat/completions' },
  { value: 'openai-response', label: 'OpenAI', path: '/v1/responses' },
  {
    value: 'openai-response-compact',
    label: 'OpenAI',
    path: '/v1/responses/compact',
  },
  { value: 'anthropic', label: 'Anthropic', path: '/v1/messages' },
  {
    value: 'gemini',
    label: 'Gemini',
    path: '/v1beta/models/{model}:generateContent',
  },
  { value: 'jina-rerank', label: 'Jina', path: '/v1/rerank' },
  {
    value: 'image-generation',
    label: 'Image Generation',
    path: '/v1/images/generations',
  },
  { value: 'embeddings', label: 'Embeddings', path: '/v1/embeddings' },
] as const

const STREAM_INCOMPATIBLE_ENDPOINTS = new Set([
  'embeddings',
  'image-generation',
  'jina-rerank',
  'openai-response-compact',
])

export function MyChannelTestDialog() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { testRow, setTestRow } = useMyChannels()
  const models = parseModelList(testRow?.models)
  const modelOptions = [
    ...new Set(
      [testRow?.test_model?.trim(), ...models].filter((item): item is string =>
        Boolean(item)
      )
    ),
  ]
  const [model, setModel] = useState('')
  const [endpoint, setEndpoint] = useState('auto')
  const [stream, setStream] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [responseTime, setResponseTime] = useState<number | null>(null)

  useEffect(() => {
    if (!testRow) return
    const rowModels = parseModelList(testRow.models)
    setModel(testRow.test_model || rowModels[0] || '')
    setEndpoint('auto')
    setStream(false)
    setError('')
    setResponseTime(null)
  }, [testRow])

  const streamIncompatible = STREAM_INCOMPATIBLE_ENDPOINTS.has(endpoint)

  const runTest = async () => {
    if (!testRow) return
    setTesting(true)
    setError('')
    setResponseTime(null)
    try {
      const res = await testMyChannel(testRow.id, {
        model,
        endpointType: endpoint === 'auto' ? undefined : endpoint,
        stream: streamIncompatible ? false : stream,
      })
      if (!res.success) {
        handleServerError(createServerError(res, t('Channel test failed')))
        setError(res.message || t('Channel test failed'))
        return
      }
      setResponseTime(res.time ?? null)
      await queryClient.invalidateQueries({ queryKey: MY_CHANNELS_QUERY_KEY })
    } catch (testError) {
      handleServerError(testError, t('Channel test failed'))
    } finally {
      setTesting(false)
    }
  }

  return (
    <Dialog
      open={testRow !== null}
      onOpenChange={(open) => {
        if (!open) setTestRow(null)
      }}
      title={t('Test Connection')}
      description={testRow?.name}
      contentHeight='auto'
      footer={
        <>
          <Button
            variant='outline'
            disabled={testing}
            onClick={() => setTestRow(null)}
          >
            {t('Close')}
          </Button>
          <Button disabled={testing || !model} onClick={() => void runTest()}>
            {testing && <Loader2 className='mr-2 size-4 animate-spin' />}
            {testing ? t('Testing...') : t('Test Connection')}
          </Button>
        </>
      }
    >
      <div className='space-y-4'>
        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='space-y-2'>
            <Label>{t('Model')}</Label>
            <Select
              value={model}
              onValueChange={(value) => setModel(value ?? model)}
            >
              <SelectTrigger className='w-full'>
                <SelectValue placeholder={t('Select model')} />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-2'>
            <Label>{t('Endpoint')}</Label>
            <Select
              value={endpoint}
              onValueChange={(value) => {
                const next = value ?? endpoint
                setEndpoint(next)
                if (STREAM_INCOMPATIBLE_ENDPOINTS.has(next)) {
                  setStream(false)
                }
              }}
            >
              <SelectTrigger className='w-full'>
                <SelectValue placeholder={t('Endpoint')} />
              </SelectTrigger>
              <SelectContent>
                {ENDPOINT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {t(option.label)}
                    {'path' in option ? ` · ${option.path}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className='flex items-center justify-between gap-3 rounded-lg border p-3'>
          <div>
            <Label htmlFor='my-channel-test-stream'>{t('Streaming')}</Label>
            {streamIncompatible && (
              <p className='text-muted-foreground mt-1 text-xs'>
                {t('This endpoint does not support streaming.')}
              </p>
            )}
          </div>
          <Switch
            id='my-channel-test-stream'
            checked={stream && !streamIncompatible}
            disabled={streamIncompatible}
            onCheckedChange={setStream}
          />
        </div>

        {responseTime !== null && (
          <Alert>
            <AlertDescription>
              {t('Connection successful')} · {t('Response Time')}:{' '}
              {responseTime.toFixed(2)}s
            </AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant='destructive'>
            <AlertDescription>{translateServerText(t, error)}</AlertDescription>
          </Alert>
        )}
      </div>
    </Dialog>
  )
}
