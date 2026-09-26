import { Link } from "react-router-dom"
import { ArrowLeft, MapPinned } from "lucide-react"
import { LogoMark } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"

export default function NotFoundPage() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-6 text-center">
      <div>
        <LogoMark className="mx-auto size-20 animate-float" />
        <p className="font-heading mt-6 text-7xl font-semibold tracking-tight text-sage-300">404</p>
        <h1 className="font-heading mt-2 text-2xl font-medium">This roof isn’t on our map</h1>
        <p className="mt-2 text-muted-foreground">The page you were looking for doesn’t exist.</p>
        <div className="mt-8 flex justify-center gap-2">
          <Button asChild variant="outline" className="h-11 rounded-xl bg-card font-semibold"><Link to="/"><ArrowLeft /> Home</Link></Button>
          <Button asChild className="h-11 rounded-xl font-semibold"><Link to="/app"><MapPinned /> Open dashboard</Link></Button>
        </div>
      </div>
    </div>
  )
}
