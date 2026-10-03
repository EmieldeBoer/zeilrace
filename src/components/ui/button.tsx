import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// Knoppen in het piratenthema: messing beslag (default), donker hout (secondary),
// ossenbloed (destructive), het kanon (kanon) en verdigris (groen).
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding font-kap font-bold tracking-wide whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-messing-donker bg-[image:var(--messing-bg)] text-inkt shadow-[inset_0_1px_0_#f7e2a6,0_2px_0_#3d2a0e] hover:bg-[image:var(--messing-bg-hover)] aria-pressed:shadow-[inset_0_0_0_3px_var(--color-bloed),0_2px_0_#3d2a0e]",
        secondary:
          "border-messing-donker bg-[image:linear-gradient(#3a2a1a,#221810)] text-ivoor shadow-[inset_0_1px_0_#5a4228,0_2px_0_#000] hover:text-goud aria-pressed:shadow-[inset_0_0_0_3px_var(--color-goud),0_2px_0_#000]",
        destructive:
          "border-[#3d0d07] bg-[image:linear-gradient(#9b2a1f,#6e1a12)] text-[#ffe9dc] shadow-[inset_0_1px_0_#c65a4a,0_2px_0_#2a0804] hover:brightness-110",
        kanon:
          "border-[#4a1d06] bg-[image:linear-gradient(#d06a2c,#8e3c12)] text-[#fff4e2] shadow-[inset_0_1px_0_#f0a070,0_2px_0_#3a1605] hover:brightness-110",
        groen:
          "border-[#173a2b] bg-[image:linear-gradient(#4f9a74,var(--color-verdigris))] text-[#f2fff5] shadow-[inset_0_1px_0_#86c9a2,0_2px_0_#10281d] hover:brightness-110",
        outline:
          "border-input bg-transparent hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent",
        ghost:
          "hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent",
        link: "font-sans font-normal tracking-normal text-current underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 gap-1.5 px-3 text-sm",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "min-h-11 gap-1.5 px-3 py-2 text-sm",
        xl: "min-h-[50px] w-full gap-2 px-3 py-2.5 text-[0.92rem] whitespace-normal",
        icon: "size-9",
        "icon-xs": "size-6 rounded-[min(var(--radius-md),10px)] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-[min(var(--radius-md),12px)]",
        "icon-lg": "size-11 text-xl",
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
