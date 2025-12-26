import { Routes, Route, Navigate } from 'react-router-dom'
import Home from '@pages/Home'
import AboutUs from '@pages/AboutUs'
import AddProperty from '@pages/AddProperty'
import Blog from '@pages/Blog'
import BlogDetail from '@pages/BlogDetail'
import BlogGrid from '@pages/BlogGrid'
import Contact from '@pages/Contact'
import Dashboard from '@pages/Dashboard'
import FAQ from '@pages/FAQ'
import Messages from '@pages/Messages'
import MyFavorites from '@pages/MyFavorites'
import MyProfile from '@pages/MyProfile'
import MyProperty from '@pages/MyProperty'
import OurService from '@pages/OurService'
import Pricing from '@pages/Pricing'
import PrivacyPolicy from '@pages/PrivacyPolicy'
import PropertyDetails from '@pages/PropertyDetails'
import PropertyHalfmapGrid from '@pages/PropertyHalfmapGrid'
import PropertyHalfmapList from '@pages/PropertyHalfmapList'
import Reviews from '@pages/Reviews'
import SidebarGrid from '@pages/SidebarGrid'
import SidebarList from '@pages/SidebarList'
import TopmapGrid from '@pages/TopmapGrid'
import TopmapList from '@pages/TopmapList'

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/about-us" element={<AboutUs />} />
      <Route path="/add-property" element={<AddProperty />} />
      <Route path="/blog" element={<Blog />} />
      <Route path="/blog-grid" element={<BlogGrid />} />
      <Route path="/blog/:slug" element={<BlogDetail />} />
      <Route path="/contact" element={<Contact />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/faq" element={<FAQ />} />
      <Route path="/message" element={<Messages />} />
      <Route path="/my-favorites" element={<MyFavorites />} />
      <Route path="/my-profile" element={<MyProfile />} />
      <Route path="/my-property" element={<MyProperty />} />
      <Route path="/our-service" element={<OurService />} />
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/privacy-policy" element={<PrivacyPolicy />} />
      <Route path="/property/:id" element={<PropertyDetails />} />
      <Route path="/property-halfmap-grid" element={<PropertyHalfmapGrid />} />
      <Route path="/property-halfmap-list" element={<PropertyHalfmapList />} />
      <Route path="/reviews" element={<Reviews />} />
      <Route path="/sidebar-grid" element={<SidebarGrid />} />
      <Route path="/sidebar-list" element={<SidebarList />} />
      <Route path="/topmap-grid" element={<TopmapGrid />} />
      <Route path="/topmap-list" element={<TopmapList />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
