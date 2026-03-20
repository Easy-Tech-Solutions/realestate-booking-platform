export default function Footer() {
  return (
    <footer className="footer mt-auto bg-dark text-white">
      <div className="container py-4">
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-3">
          <div className="small">© {new Date().getFullYear()} Homelengo. All rights reserved.</div>
          <div className="d-flex gap-3 small">
            <a href="/privacy-policy" className="text-white-50">Privacy Policy</a>
            <a href="/our-service" className="text-white-50">Our Service</a>
          </div>
        </div>
      </div>
    </footer>
  )
}
