import type { ThreadItem } from '@/types/thread'

export const thread: ThreadItem[] = [
  { id: 'd1', kind: 'day', label: 'sessão iniciada às 21:42 · cérebro: Claude Code' },
  {
    id: 'm1',
    kind: 'message',
    author: 'user',
    segments: [{ text: 'A Forgejo do truenas caiu de novo. Investiga e reinicia se precisar.' }],
  },
  {
    id: 'm2',
    kind: 'message',
    author: 'brain',
    segments: [
      { text: 'Cheguei no ' },
      { text: 'truenas', tone: 'mono' },
      { text: '. O serviço ' },
      { text: 'forgejo', tone: 'mono' },
      { text: ' está em ' },
      { text: 'failed', tone: 'mono' },
      { text: '.' },
    ],
  },
  { id: 't1', kind: 'tool', name: 'Bash', command: 'systemctl is-active forgejo → failed', tier: 'auto' },
  { id: 't2', kind: 'tool', name: 'Bash', command: 'journalctl -u forgejo -n 40 --no-pager', tier: 'auto' },
  {
    id: 'm3',
    kind: 'message',
    author: 'brain',
    segments: [
      {
        text: 'O log confirma erro de conexão com o Postgres. Vou reiniciar o serviço — isso altera estado, então precisa da sua aprovação.',
      },
    ],
  },
  { id: 'ap1', kind: 'approval', tool: 'Bash', node: 'truenas', command: 'systemctl restart forgejo' },
  {
    id: 't3',
    kind: 'tool',
    name: 'Bash',
    command: 'systemctl restart forgejo && systemctl is-active forgejo',
    tier: 'executed',
    gatedBy: 'ap1',
  },
  {
    id: 'm4',
    kind: 'message',
    author: 'brain',
    gatedBy: 'ap1',
    segments: [
      { text: 'Pronto — ' },
      { text: 'active', tone: 'ok' },
      { text: '. A Forgejo voltou e responde em ' },
      { text: 'git.diaslabs.com.br', tone: 'mono' },
      { text: '. Quer que eu crie um healthcheck pra reiniciar sozinho se cair?' },
    ],
  },
]
