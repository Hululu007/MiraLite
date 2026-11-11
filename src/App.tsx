import { Route, Routes } from 'react-router-dom'
import Shell from './components/Shell'
import HomePage from './pages/Home'
import ChasePage from './pages/Chase'
import MoviesPage from './pages/Movies'
import TvPage from './pages/TV'
import CatPage from './pages/Cat'
import CatSearchPage from './pages/CatSearch'
import CatDetailPage from './pages/CatDetail'
import PlayerPage from './pages/Player'
import DetailPage from './pages/Detail'
import SearchPage from './pages/Search'
import UserscriptPage from './pages/Userscript'
import SettingsPage from './pages/Settings'

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/chase" element={<ChasePage />} />
        <Route path="/movies" element={<MoviesPage />} />
        <Route path="/tv" element={<TvPage />} />
        <Route path="/cat" element={<CatPage />} />
        <Route path="/cat/search" element={<CatSearchPage />} />
        <Route path="/cat/item" element={<CatDetailPage />} />
        <Route path="/item/:id" element={<DetailPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/userscript" element={<UserscriptPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="/play/:id" element={<PlayerPage />} />
    </Routes>
  )
}
