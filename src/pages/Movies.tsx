import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Poster from '../components/Poster'
import { useCatalog } from '../lib/catalog'
import { useLibrary } from '../lib/store'

type SortKey = 'rating' | 'year' | 'title'

export default function MoviesPage() {
  const navigate = useNavigate()
  const { movies } = useCatalog()
  const { progress } = useLibrary()
  const [genre, setGenre] = useState('全部')
  const [sort, setSort] = useState<SortKey>('rating')

  const genres = useMemo(() => {
    const set = new Set<string>()
    movies.forEach((m) => m.genres.forEach((g) => set.add(g)))
    return ['全部', ...Array.from(set)]
  }, [movies])

  const list = useMemo(() => {
    const filtered = genre === '全部' ? movies : movies.filter((m) => m.genres.includes(genre))
    return [...filtered].sort((a, b) => {
      if (sort === 'year') return (b.year ?? 0) - (a.year ?? 0)
      if (sort === 'title') return a.title.localeCompare(b.title, 'zh-Hans-CN')
      return (b.rating ?? 0) - (a.rating ?? 0)
    })
  }, [movies, genre, sort])

  return (
    <div className="px-10 pb-16 pt-7">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">电影</h1>
          <p className="mt-1 text-[12px] text-muted">
            共 {list.length} 部 · 来源为你已连接的片源
          </p>
        </div>
        <div className="glass-inset flex items-center gap-1 rounded-lg p-0.5">
          {(
            [
              ['rating', '评分'],
              ['year', '年份'],
              ['title', '名称'],
            ] as Array<[SortKey, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSort(key)}
              className={`rounded-md px-2.5 py-1 text-[11.5px] transition ${
                sort === key ? 'bg-gold/90 text-black' : 'text-muted hover:text-fg'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="no-scrollbar mb-6 flex gap-2 overflow-x-auto pb-1">
        {genres.map((g) => (
          <button
            key={g}
            onClick={() => setGenre(g)}
            className={`glass-chip shrink-0 rounded-full px-3 py-1 text-[11.5px] ${
              genre === g ? 'is-active text-gold' : 'text-muted'
            }`}
          >
            {g}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3.5">
        {list.map((item) => {
          const p = progress[item.id]
          return (
            <Poster
              key={item.id}
              item={item}
              width={158}
              progress={p && p.duration ? p.position / p.duration : 0}
              onOpen={() => navigate(`/item/${item.id}`)}
            />
          )
        })}
      </div>
    </div>
  )
}
