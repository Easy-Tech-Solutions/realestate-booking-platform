import SEO from '@components/common/SEO'

export default function PageShell({ title, htmlSourceFile, children }) {
  return (
    <>
      <SEO title={title ? `${title} | Homelengo` : 'Homelengo'} />
      <div className="container py-4">
        {/* Replace this container with the exact markup from: frontend/public/" + htmlSourceFile */}
        {children}
      </div>
    </>
  )
}
