import { Link, NavLink } from 'react-router-dom'

export default function Header() {
  return (
    <header className="main-header shadow-sm bg-white">
      <div className="container">
        <div className="d-flex align-items-center justify-content-between py-3">
          <Link to="/" className="navbar-brand fw-bold text-primary">Homelengo</Link>
          <nav className="d-none d-md-flex align-items-center gap-4">
            <NavLink to="/about-us" className="nav-link">About</NavLink>
            <NavLink to="/blog" className="nav-link">Blog</NavLink>
            <NavLink to="/pricing" className="nav-link">Pricing</NavLink>
            <NavLink to="/contact" className="nav-link">Contact</NavLink>
            <NavLink to="/add-property" className="btn btn-outline-primary rounded-pill px-3">Add Property</NavLink>
          </nav>
        </div>
      </div>
    </header>
  )
}
