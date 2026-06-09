import type { Session } from '@/types/session'

export const sessions: Session[] = [
  {
    id: '9f3a-c12e',
    title: 'Restart Forgejo no truenas',
    node: 'truenas',
    directory: '~/infra',
    updatedAt: 'agora',
    snippet: 'Claude quer reiniciar o serviço — aprovação pendente.',
    status: 'waiting',
    live: true,
  },
  {
    id: '7b21-d004',
    title: 'Diagnóstico UFW FORWARD',
    node: 'diaslabs',
    directory: '~/edge',
    updatedAt: '2 min',
    snippet: 'Lendo before.rules via journalctl…',
    status: 'working',
    live: true,
  },
  {
    id: '4c88-a91f',
    title: 'Deploy Open WebUI',
    node: 'debian',
    directory: '~/stacks',
    updatedAt: '1 h',
    snippet: 'Container no ar na porta 3000.',
    status: 'idle',
    live: false,
  },
  {
    id: '1d50-f7aa',
    title: 'Sync .claude via Forgejo',
    node: 'odin',
    directory: '~/claude-config',
    updatedAt: 'ontem',
    snippet: 'Sessão fechada — retomável.',
    status: 'closed',
    live: false,
  },
]
