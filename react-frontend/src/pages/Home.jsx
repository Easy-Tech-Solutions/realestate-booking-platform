import PageShell from './_PageShell'

export default function Home() {
  return (
    <PageShell title="Home" htmlSourceFile="index.html">
      <div className="text-center py-5">
        <h1 className="display-5 fw-bold">Homepage</h1>
        <p className="lead mt-3">Port the hero, sliders, and search UI from the legacy homepage into this component.</p>
      </div>
    </PageShell>
  )
}
