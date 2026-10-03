import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// Knoppen: hoofdknop (default), stil (secondary), gevaar (destructive), start (kanon)
// en bevestigen (groen). De kleuren komen uit het thema (src/index.css).
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding font-kop font-bold tracking-wide whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/60 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-[var(--knop-rand)] bg-[image:var(--knop-bg)] text-[var(--knop-fg)] shadow-[var(--knop-schaduw)] hover:bg-[image:var(--knop-bg-hover)] aria-pressed:ring-4 aria-pressed:ring-[var(--seingeel)] aria-pressed:ring-offset-1",
        secondary:
          "border-[var(--stil-rand)] bg-[image:var(--stil-bg)] bg-[color:var(--stil-bg)] text-[var(--stil-fg)] hover:brightness-95 aria-pressed:ring-4 aria-pressed:ring-[var(--seingeel)]",
        destructive:
          "border-[var(--rood-rand)] bg-[image:var(--rood-bg)] text-white hover:brightness-110",
        kanon:
          "border-[var(--kanon-rand)] bg-[image:var(--kanon-bg)] text-white hover:brightness-110",
        groen:
          "border-[var(--groen-rand)] bg-[image:var(--groen-bg)] text-white hover:brightness-110",
        outline:
          "border-input bg-transparent hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent",
        ghost:
          "hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent",
        link: "font-sans font-normal tracking-normal text-current underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 gap-1.5 px-3.5 text-sm",
        xs: "h-7 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1 rounded-[min(var(--radius-md),12px)] px-3 text-[0.82rem] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "min-h-12 gap-1.5 px-4 py-2 text-base",
        xl: "min-h-[54px] w-full gap-2 px-3 py-2.5 text-[0.95rem] whitespace-normal",
        icon: "size-10",
        "icon-xs": "size-7 rounded-[min(var(--radius-md),10px)] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9 rounded-[min(var(--radius-md),12px)]",
        "icon-lg": "size-12 text-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
