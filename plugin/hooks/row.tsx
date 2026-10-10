import type { ClientModule } from 'claude-code'

import type { RowMessage } from '../types'

type RowProps = { id: string; label: string; isDim: boolean }

// A row's summary: a click toggles its card, a right-click acknowledges it.
const Row: ClientModule<RowProps> = (props, surface) => {
  const { Text } = surface.elements

  surface.onPointer(e => {
    if (e.type !== 'down' || (e.button !== 'left' && e.button !== 'right')) return

    const message: RowMessage = { id: props.id, action: e.button === 'right' ? 'acknowledge' : 'toggle' }
    surface.post(message)
  })

  return <Text dimColor={props.isDim}>{props.label}</Text>
}

export default Row
