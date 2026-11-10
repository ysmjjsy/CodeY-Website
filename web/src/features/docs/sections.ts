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
/**
 * The two groups of the docs center. `codeguys` is the platform; `codey` is
 * one product that runs on it. Titles and paragraphs are i18n keys, held here
 * so the sidebar, the index, and each section page read the same source.
 */

export type DocSection = {
  slug: string
  group: 'codeguys' | 'codey'
  title: string
  summary: string
  paragraphs: string[]
}

export const DOC_SECTIONS: DocSection[] = [
  {
    slug: 'gateway',
    group: 'codeguys',
    title: 'What CodeGuys is',
    summary: 'One gateway in front of many model providers.',
    paragraphs: [
      'CodeGuys sits between your application and the model providers. Your code talks to one endpoint, and the gateway decides which upstream answers, how the request is billed, and what happens when a provider fails.',
      'The providers behind it include OpenAI, Claude, Gemini, and several dozen more. Adding one is a channel configuration, not a change to the code that calls the gateway.',
    ],
  },
  {
    slug: 'getting-started',
    group: 'codeguys',
    title: 'Getting started',
    summary: 'From an empty account to a first request.',
    paragraphs: [
      "Create an account, then open the console. Add a channel for the provider you want to call and give it that provider's key. The gateway checks the key before it accepts traffic on the channel.",
      "Create an API key for your own application, copy the base URL shown in the console, and send a request in the provider's usual format. The path does not change between providers; the channel does.",
    ],
  },
  {
    slug: 'api',
    group: 'codeguys',
    title: 'Calling the API',
    summary: 'The protocols the gateway accepts.',
    paragraphs: [
      "The gateway accepts the request formats your tools already speak, including the OpenAI, Claude, and Gemini chat routes. Point the tool's base URL at CodeGuys and use the key you created; leave the rest of the tool alone.",
      'Streaming, tool calls, and embeddings pass through where the upstream supports them. When a provider and the route you called disagree, the gateway reports that mismatch instead of silently dropping the field.',
    ],
  },
  {
    slug: 'billing',
    group: 'codeguys',
    title: 'Billing and quotas',
    summary: 'How usage turns into a charge.',
    paragraphs: [
      'Each model carries a price, and every settled request writes a usage record against it. You can read that record per key, per user, and per model, which is also what the rankings are built from.',
      'Quotas cap how far a key or a user can go. A request that would pass the cap is refused before it reaches the provider, so the bill stops where you set it.',
    ],
  },
  {
    slug: 'codey',
    group: 'codey',
    title: 'What CodeY is',
    summary: 'A local AI work partner, and one product of CodeGuys.',
    paragraphs: [
      'CodeY takes a goal, files, or a project and works on it locally. It keeps a record of the task, asks before it steps outside the permissions you gave it, and shows the commands and file changes on one timeline.',
      'It is a product built on CodeGuys, not a separate platform. The models it calls are the models you configured on the gateway.',
    ],
  },
  {
    slug: 'codey-install',
    group: 'codey',
    title: 'Installing CodeY',
    summary: 'Desktop builds and running from source.',
    paragraphs: [
      'Packaged builds are published for macOS, Windows, and Linux. Download the latest one, open it, and point it at a project directory.',
      'Building from source needs Node.js, pnpm, and Rust, plus the system libraries the desktop shell asks for. The build produces the desktop app and the local daemon it talks to.',
    ],
  },
  {
    slug: 'codey-models',
    group: 'codey',
    title: 'Connecting CodeY to models',
    summary: 'CodeY uses the gateway you already run.',
    paragraphs: [
      "Open CodeY's model settings and point them at your CodeGuys base URL with one of your gateway keys. CodeY then calls models exactly as any other application on the gateway does.",
      'Billing, quotas, and provider routing stay where you set them on CodeGuys. Changing a price or a channel there changes what CodeY can spend and which provider answers it.',
    ],
  },
  {
    slug: 'codey-runtime',
    group: 'codey',
    title: 'Desktop and the runtime',
    summary: 'Two clients, one daemon.',
    paragraphs: [
      'The desktop app is a client. It sends a task to a daemon running on the same machine, and the daemon is what actually calls tools, writes files, and talks to models.',
      'The runtime exposes that same daemon to your own programs through one local protocol, with clients for TypeScript, Python, and Rust. A task started from any of them is the same kind of task the desktop runs.',
    ],
  },
]

export const DOC_GROUPS = [
  {
    id: 'codeguys',
    title: 'CodeGuys',
    description: 'The unified API gateway.',
  },
  {
    id: 'codey',
    title: 'CodeY',
    description: 'A product built on CodeGuys.',
  },
] as const
