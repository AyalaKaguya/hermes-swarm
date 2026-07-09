import { cn } from "@/lib/utils"
import { useTextTranslation } from "@/hooks/use-text-translation"
import { Loader2Icon } from "lucide-react"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const tr = useTextTranslation()
  return (
    <Loader2Icon data-slot="spinner" role="status" aria-label={tr("加载中")} className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
