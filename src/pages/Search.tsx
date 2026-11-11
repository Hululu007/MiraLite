import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Poster from '../components/Poster'
import { useCatalog } from '../lib/catalog'

export default function SearchPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const catalog = useCatalog()
  const q = (params.get('q') ?? '').trim().toLowerCase()

  const results = useMemo(() => {
    if (!q) return []
    return catalog.items.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        i.genres.some((g) => g.toLowerCase().includes(q)) ||
        (i.group ?? '').toLowerCase().includes(q),
    )
  }, [q, catalog])

  return (
    <div className="px-10 pb-16 pt-7">
      <h1 className="text-[20px] font-semibold tracking-tight">
        {q ? `“${q}” 的搜索结果` : '搜索'}
      </h1>
      <p className="mt-1 text-[12px] text-muted">共 {results.length} 个结果</p>

      {results.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-line/70 py-14 text-center text-[12.5px] text-muted">
          没找到匹配的内容，换个关键词试试，或先到「片源」里连接更多源。
        </div>
      ) : (
        <div className="mt-6 flex flex-wrap gap-3.5">
          {results.map((item) => (
            <Poster
              key={item.id}
              item={item}
              width={150}
              onOpen={() =>
                navigate(item.kind === 'channel' ? `/play/${item.id}` : `/item/${item.id}`)
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
