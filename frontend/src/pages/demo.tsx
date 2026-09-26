import { Link } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import StackSpreadDemo from "@/components/demo/stack-spread-demo"

/** /demo - the StackSpread component on its own, exactly as the template's demo.tsx. */
export default function DemoPage() {
  return (
    <div>
      <Link to="/" className="fixed top-4 left-4 z-50 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-sm font-semibold shadow">
        <ArrowLeft className="size-4" /> SuryaJal
      </Link>
      <div className="grid h-[60vh] place-items-center bg-[#ececeb] text-center">
        <div>
          <p className="text-xs font-bold tracking-[0.2em] text-neutral-500 uppercase">Component demo</p>
          <h1 className="mt-2 text-4xl font-medium tracking-tight">StackSpread</h1>
          <p className="mt-2 text-neutral-500">Scroll down ↓</p>
        </div>
      </div>
      <StackSpreadDemo />
      <div className="grid h-[50vh] place-items-center bg-[#ececeb] text-neutral-500">End of demo</div>
    </div>
  )
}
