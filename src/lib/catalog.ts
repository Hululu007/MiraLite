import { useMemo } from 'react'
import { allDemo } from '../data/demo'
import type { CatalogState, MediaItem } from './types'
import { useLibrary } from './store'

export function useCatalog(): CatalogState {
  const { channels } = useLibrary()

  return useMemo(() => {
    const userChannels = channels ?? []
    const items = [...allDemo, ...userChannels]
    const byId: Record<string, MediaItem> = {}
    for (const item of items) byId[item.id] = item

    return {
      items,
      byId,
      channels: items.filter((i) => i.kind === 'channel'),
      movies: items.filter((i) => i.kind === 'movie'),
      series: items.filter((i) => i.kind === 'series'),
    }
  }, [channels])
}
