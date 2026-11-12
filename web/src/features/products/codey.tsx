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
import { ArrowRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useMediaQuery } from '@/hooks/use-media-query'

/**
 * CodeY, as one product of CodeGuys. The page shows the one thing the homepage
 * band cannot: one task, as the desktop app records it. Anything about models
 * and billing points back at the gateway instead of being restated.
 */

/**
 * One task, in the order CodeY records it: the file it read, the file it
 * changed, the test it ran, the change set, and the command it will not run
 * until it is allowed. The last one stays open.
 */
const TASK = [
  {
    kind: 'Read a file',
    detail: 'src/recovery.rs',
    extra: '38 lines',
    waiting: false,
  },
  {
    kind: 'Edit a file',
    detail: 'src/recovery.rs',
    extra: '+6 −1',
    waiting: false,
  },
  {
    kind: 'Run a command',
    detail: 'cargo test -p codey-harness-daemon',
    extra: '5 passed',
    waiting: false,
  },
  {
    kind: 'Change set',
    detail: '2 files changed',
    extra: '+18 −0',
    translateDetail: true,
    waiting: false,
  },
  {
    kind: 'Waiting for permission',
    detail: 'git commit -m "fix: replay committed events"',
    extra: '',
    waiting: true,
  },
]

/** How long each step stays before the next one appears. */
const STEP_MS = 900

/**
 * Plays the task once. A visitor who asked for less motion gets the whole task
 * straight away, so the story never depends on the animation running.
 */
function useTaskPlayback(): number {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [shown, setShown] = useState(reduceMotion ? TASK.length : 1)

  useEffect(() => {
    if (reduceMotion) return
    if (shown >= TASK.length) return
    const timer = setTimeout(() => setShown((count) => count + 1), STEP_MS)
    return () => clearTimeout(timer)
  }, [reduceMotion, shown])

  return reduceMotion ? TASK.length : shown
}

/**
 * The workspace entries the desktop app ships. Each one is a place work happens,
 * not a claim about the gateway.
 */
const WORKSPACE = [
  {
    title: 'Code intelligence',
    desc: 'Search, trace, and inspect the code in a project from a local index that can be rebuilt.',
    // A search hit, then the line it lands on. The mark is the match.
    preview: [
      { text: 'replay_committed', accent: true },
      { text: 'src/recovery.rs:42', accent: false },
    ],
  },
  {
    title: 'Office documents',
    desc: 'Check, preview, and commit Word, Excel, and PowerPoint files through a bundled runtime.',
    preview: [
      { text: 'report.docx', accent: false },
      { text: 'slides.pptx', accent: false },
      { text: 'sheet.xlsx', accent: false },
    ],
  },
  {
    title: 'Recorded meetings',
    desc: 'Capture or import audio, transcribe it, and turn it into a summary.',
    preview: [
      { text: '00:12', accent: true },
      { text: '04:37', accent: true },
      { text: '11:02', accent: true },
    ],
  },
  {
    title: 'Roundtable',
    desc: 'Several agents take positions in parallel, and a host sums them up into a conclusion you can reopen.',
    preview: [
      { text: 'A', accent: true },
      { text: 'B', accent: true },
      { text: 'C', accent: true },
    ],
  },
  {
    title: 'Template marketplace',
    desc: 'Build an agent, a team, or a workflow, install it as a package, and publish it through CodeY Cloud.',
    preview: [
      { text: 'agent.codeypkg', accent: false },
      { text: 'team.codeypkg', accent: false },
    ],
  },
  {
    title: 'Search everywhere',
    desc: 'Find a conversation, a file, a skill, a tool, a project, or a setting from the title bar.',
    preview: [
      { text: '⌘K', accent: true },
      { text: 'recovery', accent: false },
    ],
  },
]

/**
 * What CodeY can do with a task, beyond the places the workspace offers.
 */
const CAPABILITIES = [
  {
    index: '01',
    title: 'Tasks that resume',
    desc: 'The task is written down as it happens, so reopening the app, or restarting the daemon, picks it up again.',
  },
  {
    index: '02',
    title: 'Agents that work together',
    desc: 'Hand part of a task to another agent, run a team, or leave a workflow running in the background.',
  },
  {
    index: '03',
    title: 'Browser and computer use',
    desc: 'Drive a browser, or the computer itself, and only after you allow it.',
  },
  {
    index: '04',
    title: 'macOS, Windows, and Linux',
    desc: 'The desktop app ships for all three. What it can do to the computer itself depends on the platform.',
  },
]

export function CodeyProduct() {
  const { t } = useTranslation()
  const shown = useTaskPlayback()
  const taskScroll = useRef<HTMLOListElement>(null)

  // The card keeps its height, so a new step has to bring itself into view.
  useEffect(() => {
    const list = taskScroll.current
    const latest = list?.querySelector('li:last-child')
    if (!list || !(latest instanceof HTMLElement)) return
    if (latest.getBoundingClientRect === undefined) return
    const room = list.getBoundingClientRect().bottom
    const edge = latest.getBoundingClientRect().bottom
    if (edge > room) list.scrollTop += edge - room
  }, [shown])

  return (
    <PublicLayout showMainContainer={false}>
      <article className='relative overflow-hidden px-6 pt-24 pb-16 md:pt-28 md:pb-20'>
        <div
          aria-hidden='true'
          className='hero-grid pointer-events-none absolute inset-0'
        />
        {/* One arc, center off the page, so only a segment shows. Same border
            color as the grid, no fill, and it does not move. */}
        <svg
          aria-hidden='true'
          className='text-border pointer-events-none absolute inset-0 h-full w-full'
          viewBox='0 0 1200 700'
          preserveAspectRatio='xMidYMid slice'
          fill='none'
        >
          <circle
            cx='-400'
            cy='-200'
            r='780'
            stroke='currentColor'
            strokeWidth='1'
            vectorEffect='non-scaling-stroke'
          />
        </svg>

        <div className='relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-8'>
          <div className='flex flex-col items-start text-left lg:col-span-6'>
            <div className='mb-5 flex items-center gap-2.5'>
              <span className='text-brand-accent text-xs font-medium tracking-widest uppercase'>
                CodeY
              </span>
              {/* The body follows the text color, so it stays readable in both
                  themes; the wedge keeps the CodeY cyan. */}
              <img src='/codey-mark.svg' alt='' className='h-6 w-auto' />
            </div>

            <h1 className='text-[clamp(2.25rem,4.5vw,3.25rem)] leading-[1.12] font-bold tracking-tight'>
              {t('An AI work partner that finishes the task')}
            </h1>
            <p className='text-muted-foreground mt-5 max-w-xl text-base leading-relaxed'>
              {t(
                'Hand CodeY a goal, some files, a link, or a project. It analyses, creates, researches, and moves the work forward within what you authorise, then checks the result and hands it back.'
              )}
            </p>

            <div className='mt-8 flex flex-wrap items-center gap-6 text-sm font-medium'>
              <a
                href='https://github.com/ysmjjsy/CodeY-Releases/releases/latest'
                target='_blank'
                rel='noopener noreferrer'
                className='group inline-flex items-center gap-1.5'
              >
                {t('Download')}
                <ArrowRight className='size-3.5 transition-transform duration-150 group-hover:translate-x-0.5' />
              </a>
              <Link
                to='/docs/$section'
                params={{ section: 'codey' }}
                className='text-muted-foreground hover:text-foreground transition-colors duration-150'
              >
                {t('Read the CodeY docs')}
              </Link>
            </div>
          </div>

          <div className='lg:col-span-6'>
            <figure className='border-border bg-background/60 flex h-80 flex-col rounded-2xl border p-6 backdrop-blur-sm md:p-8'>
              <figcaption className='flex shrink-0 items-baseline justify-between gap-4'>
                <span className='text-sm font-semibold'>
                  {t('Repair the recovery path')}
                </span>
                <span className='text-muted-foreground font-mono text-xs'>
                  {t('Running')}
                </span>
              </figcaption>
              <ol
                ref={taskScroll}
                className='hover-scrollbar mt-5 min-h-0 flex-1 overflow-y-auto'
              >
                {TASK.slice(0, shown).map((step, index) => {
                  const last = index === TASK.length - 1
                  return (
                    <li
                      key={step.kind}
                      className='flex gap-3 motion-safe:animate-[task-step-in_0.45s_cubic-bezier(0.16,1,0.3,1)_both]'
                    >
                      <div className='flex flex-col items-center'>
                        <span
                          aria-hidden='true'
                          className={
                            step.waiting
                              ? 'border-brand-accent mt-1.5 size-2 shrink-0 rounded-full border motion-safe:animate-pulse'
                              : 'bg-brand-accent mt-1.5 size-2 shrink-0 rounded-full'
                          }
                        />
                        {!last && (
                          <span
                            aria-hidden='true'
                            className='bg-border w-px flex-1'
                          />
                        )}
                      </div>
                      <div className={last ? '' : 'pb-4'}>
                        <p className='flex flex-wrap items-baseline gap-x-2.5'>
                          <span className='text-sm font-semibold'>
                            {t(step.kind)}
                          </span>
                          {step.extra && (
                            <span className='text-muted-foreground font-mono text-xs'>
                              {t(step.extra)}
                            </span>
                          )}
                        </p>
                        <p className='text-muted-foreground mt-0.5 font-mono text-xs leading-relaxed'>
                          {step.translateDetail ? t(step.detail) : step.detail}
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </figure>
          </div>
        </div>

        <div className='border-border relative mx-auto mt-16 max-w-6xl border-t pt-8'>
          <h2 className='text-sm font-semibold'>{t('The workspace')}</h2>
          {/* One place is open at a time, the way the desktop app shows one
              workspace. The rest stay as a list you can move through. */}
          <Tabs
            defaultValue={WORKSPACE[0]?.title}
            className='mt-6 gap-10 lg:grid lg:grid-cols-[16rem_1fr] lg:items-stretch'
          >
            <TabsList
              variant='line'
              className='h-auto w-full flex-col items-stretch justify-start group-data-horizontal/tabs:h-auto'
            >
              {WORKSPACE.map((entry) => (
                <TabsTrigger
                  key={entry.title}
                  value={entry.title}
                  className='h-auto flex-none justify-start px-0 py-3 text-base font-semibold after:w-0'
                >
                  <span
                    aria-hidden='true'
                    className='bg-brand-accent size-1.5 shrink-0 rounded-full opacity-0 in-data-active:opacity-100'
                  />
                  {t(entry.title)}
                </TabsTrigger>
              ))}
            </TabsList>
            {WORKSPACE.map((entry) => (
              <TabsContent
                key={entry.title}
                value={entry.title}
                className='lg:col-start-2 lg:row-start-1 lg:h-full'
              >
                <div className='border-border bg-background/60 flex h-full flex-col justify-center rounded-2xl border p-6 backdrop-blur-sm md:p-8'>
                  <p className='flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs'>
                    {entry.preview.map((line) => (
                      <span
                        key={line.text}
                        className={line.accent ? 'text-brand-accent' : ''}
                      >
                        {line.text}
                      </span>
                    ))}
                  </p>
                  <p className='text-muted-foreground mt-4 max-w-xl text-sm leading-relaxed'>
                    {t(entry.desc)}
                  </p>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </div>

        <div className='border-border relative mx-auto mt-12 max-w-6xl border-t pt-2'>
          <h2 className='sr-only'>{t('What it can do')}</h2>
          <dl>
            {CAPABILITIES.map((entry) => (
              <div
                key={entry.title}
                className='border-border/60 grid gap-x-8 gap-y-1 border-b py-5 sm:grid-cols-[4.5rem_16rem_1fr]'
              >
                <dt className='text-brand-accent font-mono text-xs sm:row-span-2 sm:self-center'>
                  {entry.index}
                </dt>
                <dt className='text-sm font-semibold sm:self-center'>
                  {t(entry.title)}
                </dt>
                <dd className='text-muted-foreground text-sm leading-relaxed sm:self-center'>
                  {t(entry.desc)}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className='border-border relative mx-auto mt-12 grid max-w-6xl gap-x-12 gap-y-8 border-t pt-8 sm:grid-cols-3'>
          <div>
            <h2 className='text-sm font-semibold'>{t('Desktop workspace')}</h2>
            <p className='text-muted-foreground mt-1.5 text-sm leading-relaxed'>
              {t(
                'Open a project, describe the outcome, and follow the task as it runs. The desktop app sends the work to a local daemon; it never does the work itself.'
              )}
            </p>
          </div>
          <div>
            <h2 className='text-sm font-semibold'>{t('Agent Runtime')}</h2>
            <p className='text-muted-foreground mt-1.5 text-sm leading-relaxed'>
              {t(
                'Build your own application against the same daemon. The runtime speaks one local protocol, with clients for TypeScript, Python, and Rust.'
              )}
            </p>
          </div>
          <div>
            <h2 className='text-sm font-semibold'>
              {t('Permissions you set, and a sandbox')}
            </h2>
            <p className='text-muted-foreground mt-1.5 text-sm leading-relaxed'>
              {t(
                'Choose how much CodeY may do on its own. A sandbox, a workspace boundary, and a network policy hold it to that choice.'
              )}
            </p>
          </div>
        </div>
      </article>
    </PublicLayout>
  )
}
