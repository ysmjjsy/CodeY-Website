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
import { Link } from '@tanstack/react-router'
import { ArrowRight, Check, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

const CODE_SNIPPET = `curl https://api.codeguys.example/v1/chat/completions \\
  -H "Authorization: Bearer $CODEGUYS_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "your-model",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`

export function TmDeveloper() {
  const { t } = useTranslation()
  // notify: true — the hook shows the app's shared sonner toast itself.
  const { copiedText, copyToClipboard } = useCopyToClipboard({
    resetAfterMs: 2200,
  })
  const copied = copiedText === CODE_SNIPPET

  const copy = () => {
    void copyToClipboard(CODE_SNIPPET)
  }

  return (
    <section
      id='developers'
      className='tm-developer tm-space'
      aria-labelledby='tm-developer-title'
    >
      <div className='tm-shell tm-developer-grid'>
        <div className='tm-developer-copy'>
          <p className='tm-label'>{t('Developers')}</p>
          <h2 id='tm-developer-title'>
            {t('Pick a model,')}
            <br />
            {t('start with one call.')}
          </h2>
          <p>
            {t(
              'Use your account API key to call market models through a compatible endpoint. Swap the Base URL, pick a model, send a request — usage and cost land in your account record.'
            )}
          </p>
          <Link to='/docs' className='tm-inline-link'>
            {t('View the call example')}
            <ArrowRight aria-hidden='true' />
          </Link>
        </div>

        <div className='tm-code-example'>
          <div className='tm-code-top'>
            <span>{t('Call example')}</span>
            <button type='button' className='tm-copy-button' onClick={copy}>
              {copied ? (
                <Check aria-hidden='true' />
              ) : (
                <Copy aria-hidden='true' />
              )}
              <span>{copied ? t('Copied') : t('Copy')}</span>
            </button>
          </div>
          <pre>
            <code>
              <span className='tm-code-muted'>curl</span>{' '}
              https://api.codeguys.example/v1/chat/completions \{'\n'}
              {'  '}-H{' '}
              <span className='tm-code-string'>
                "Authorization: Bearer $CODEGUYS_KEY"
              </span>{' '}
              \{'\n'}
              {'  '}-H{' '}
              <span className='tm-code-string'>"Content-Type: application/json"</span>{' '}
              \{'\n'}
              {'  '}-d{' '}
              <span className='tm-code-string'>
                {'\'{\n    "model": "your-model",\n    "messages": [{"role": "user", "content": "Hello"}]\n  }\''}
              </span>
            </code>
          </pre>
          <div className='tm-code-footer'>
            <span className='tm-live-dot' />
            {t('Example address and model name — replace with real config')}
          </div>
        </div>
      </div>
    </section>
  )
}
