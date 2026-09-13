/**
 * AnimatedButton
 *
 * A vertical pill button with a double-ring animated gradient border.
 * Layout is flexible — sizes to content via paddingX / paddingY.
 *
 * Peer dependencies: react, framer-motion
 *
 * Usage:
 *   import { AnimatedButton } from "@/components/ui/animated-button";
 *
 *   <AnimatedButton />
 *   <AnimatedButton theme="light" label="Add" mode="animated" />
 *   <AnimatedButton outerColor="#ff0080" textColor="#fff" onClick={...} />
 */

import { useRef } from "react";
import { animate, motion, useMotionValue } from "framer-motion";
import { Flashcards } from "@/generated/icons";
import { GradientBorder } from "./GradientBorder";

// ─── Inject required CSS once (no separate stylesheet needed) ─────────────────

const STYLE_ID = "__animated-button-styles__";
if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = `
    @property --gb-angle {
      syntax: "<angle>";
      initial-value: 0deg;
      inherits: false;
    }
    @keyframes gb-rotate {
      to { --gb-angle: 360deg; }
    }
  `;
  document.head.appendChild(el);
}

// ─── Internal resolved config type ───────────────────────────────────────────

type Config = {
  /** Outer ring gradient base color (hex) */
  outerColor: string;
  /** Solid base color painted under the outer gradient (hex) */
  outerBgColor: string;
  /** Outer ring width — Tailwind padding class e.g. "p-px" */
  outerBorderWidth: string;
  /** Gap color between the two rings */
  gapColor: string;
  /** Gap width — Tailwind padding class e.g. "p-0" */
  gapWidth: string;
  /** Inner ring gradient base color (hex) */
  innerColor: string;
  /** Inner ring width — Tailwind padding class e.g. "p-px" */
  innerBorderWidth: string;
  /** Button fill color */
  buttonBg: string;
  /** Label and icon color */
  textColor: string;
  /** Full rotation duration in seconds */
  animationDuration: number;
  /** Scale factor when pressed — should be slightly below 1 */
  pressScale: number;
  /** Framer Motion spring stiffness */
  stiffness: number;
  /** Framer Motion spring damping */
  damping: number;
  /** Horizontal padding inside the button content area — Tailwind class e.g. "px-2.5" */
  paddingX: string;
  /** Vertical padding inside the button content area — Tailwind class e.g. "py-2" */
  paddingY: string;
};

// ─── Theme presets ────────────────────────────────────────────────────────────

const DARK: Config = {
  outerColor:        "#152656",
  outerBgColor:      "var(--color-blue)",
  outerBorderWidth:  "p-px",
  gapColor:          "var(--color-blue-foreground)",
  gapWidth:          "p-0",
  innerColor:        "#0a0a0a",
  innerBorderWidth:  "p-px",
  buttonBg:          "var(--color-blue-foreground)",
  textColor:         "var(--color-blue)",
  animationDuration: 6,
  pressScale:        0.95,
  stiffness:         400,
  damping:           15,
  paddingX:          "px-2",
  paddingY:          "pt-3 pb-2",
};

const LIGHT: Config = {
  outerColor:        "#c0ebfe",
  outerBgColor:      "#6aade7",
  outerBorderWidth:  "p-px",
  gapColor:          "var(--color-blue-foreground)",
  gapWidth:          "p-0",
  innerColor:        "#ffffff",
  innerBorderWidth:  "p-px",
  buttonBg:          "var(--color-blue-foreground)",
  textColor:         "var(--color-blue)",
  animationDuration: 6,
  pressScale:        0.95,
  stiffness:         400,
  damping:           15,
  paddingX:          "px-2",
  paddingY:          "pt-3 pb-2",
};

// ─── Gradient stop builders ───────────────────────────────────────────────────

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

function makeDarkOuterColors(hex: string): string[] {
  const rgb = hexToRgb(hex);
  return [
    `rgba(${rgb}, 0.95) 0%`,
    `rgba(${rgb}, 0.12) 45%`,
    `rgba(${rgb}, 0.06) 62%`,
    `rgba(${rgb}, 0.90) 100%`,
  ];
}

function makeDarkInnerColors(hex: string): string[] {
  const rgb = hexToRgb(hex);
  return [
    `rgba(${rgb}, 0.70) 0%`,
    `rgba(${rgb}, 0.04) 50%`,
    `rgba(${rgb}, 0.02) 65%`,
    `rgba(${rgb}, 0.60) 100%`,
  ];
}

function makeLightOuterColors(hex: string): string[] {
  const rgb = hexToRgb(hex);
  return [
    `rgba(${rgb}, 1.00) 0%`,
    `rgba(${rgb}, 0.00) 35%`,
    `rgba(${rgb}, 0.15) 50%`,
    `rgba(${rgb}, 1.00) 100%`,
  ];
}

function makeLightInnerColors(hex: string): string[] {
  const rgb = hexToRgb(hex);
  return [
    `rgba(${rgb}, 0.95) 0%`,
    `rgba(${rgb}, 0.10) 35%`,
    `rgba(${rgb}, 0.10) 50%`,
    `rgba(${rgb}, 0.75) 100%`,
  ];
}

// ─── Default icon ─────────────────────────────────────────────────────────────


// ─── Public types ─────────────────────────────────────────────────────────────

export type AnimatedButtonTheme = "dark" | "light";
export type AnimatedButtonMode  = "animated" | "auto";

type IconComponent = React.ComponentType<{ size?: number; className?: string }>

export type AnimatedButtonProps = Partial<Config> & {
  /** Text label rendered above the icon. Default: "Add" */
  label?: string;
  /** Icon component rendered below the label. Default: ArrowInCircle SVG */
  icon?: IconComponent;
  /** Color theme preset applied when individual props are not provided. Default: "dark" */
  theme?: AnimatedButtonTheme;
  /** Border animation mode. Default: "auto" */
  mode?: AnimatedButtonMode;
  /** Click handler */
  onClick?: () => void;
  /** Extra className on the root element */
  className?: string;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function AnimatedButton({
  label = "Add",
  icon: Icon,
  theme = "dark",
  mode  = "auto",
  onClick,
  className,
  outerColor,
  outerBgColor,
  outerBorderWidth,
  gapColor,
  gapWidth,
  innerColor,
  innerBorderWidth,
  buttonBg,
  textColor,
  animationDuration,
  pressScale,
  stiffness,
  damping,
  paddingX,
  paddingY,
}: AnimatedButtonProps) {
  const d = theme === "dark" ? DARK : LIGHT;

  // Resolve each value: explicit prop → theme default
  const cfg: Config = {
    outerColor:        outerColor        ?? d.outerColor,
    outerBgColor:      outerBgColor      ?? d.outerBgColor,
    outerBorderWidth:  outerBorderWidth  ?? d.outerBorderWidth,
    gapColor:          gapColor          ?? d.gapColor,
    gapWidth:          gapWidth          ?? d.gapWidth,
    innerColor:        innerColor        ?? d.innerColor,
    innerBorderWidth:  innerBorderWidth  ?? d.innerBorderWidth,
    buttonBg:          buttonBg          ?? d.buttonBg,
    textColor:         textColor         ?? d.textColor,
    animationDuration: animationDuration ?? d.animationDuration,
    pressScale:        pressScale        ?? d.pressScale,
    stiffness:         stiffness         ?? d.stiffness,
    damping:           damping           ?? d.damping,
    paddingX:          paddingX          ?? d.paddingX,
    paddingY:          paddingY          ?? d.paddingY,
  };

  const makeOuter = theme === "dark" ? makeDarkOuterColors : makeLightOuterColors;
  const makeInner = theme === "dark" ? makeDarkInnerColors : makeLightInnerColors;

  const outerColors = makeOuter(cfg.outerColor);
  const innerColors = makeInner(cfg.innerColor);

  // Spring press feedback
  const scale = useMotionValue(1);
  const springRef = useRef<ReturnType<typeof animate> | null>(null);

  const pressDown = () => {
    springRef.current?.stop();
    scale.set(cfg.pressScale);
  };
  const pressUp = () => {
    springRef.current = animate(scale, 1, {
      type: "spring",
      stiffness: cfg.stiffness,
      damping: cfg.damping,
    });
  };

  return (
    <motion.div
      style={{ scale, display: "inline-flex", boxShadow: "0 8px 16px -4px rgba(10,10,10,0.05)" }}
      className={`rounded-full ${className ?? ''}`}
    >
      {/* Outer ring */}
      <GradientBorder
        mode={mode}
        borderWidth={cfg.outerBorderWidth}
        borderOffset={1}
        borderRadius={9999}
        colors={outerColors}
        gradientType="linear"
        animationDuration={cfg.animationDuration}
        innerBackground={cfg.gapColor}
        innerStyle={{ overflow: "hidden" }}
        backgroundColor={cfg.outerBgColor}
      >
        {/* Gap */}
        <div className={cfg.gapWidth}>
          {/* Inner ring */}
          <GradientBorder
            mode={mode}
            borderWidth={cfg.innerBorderWidth}
            borderOffset={1}
            borderRadius={9999}
            colors={innerColors}
            gradientType="linear"
            animationDuration={cfg.animationDuration}
            innerBackground={cfg.buttonBg}
          >
            {/* Button content — flexible, sized by padding + content */}
            <button
              className={`group relative overflow-clip flex flex-col items-center justify-center gap-1.5 border-0 bg-transparent cursor-pointer select-none ${cfg.paddingX} ${cfg.paddingY}`}
              style={{ color: cfg.textColor }}
              onPointerDown={pressDown}
              onPointerUp={pressUp}
              onPointerLeave={pressUp}
              onClick={onClick}
            >
              <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-20 transition-opacity pointer-events-none" />
              <span className="relative z-10 text-[10px] leading-none font-bold whitespace-nowrap">
                {label}
              </span>
              <div className="relative z-10">{Icon ? <Icon size={20} /> : <Flashcards size={20} />}</div>
            </button>
          </GradientBorder>
        </div>
      </GradientBorder>
    </motion.div>
  );
}
